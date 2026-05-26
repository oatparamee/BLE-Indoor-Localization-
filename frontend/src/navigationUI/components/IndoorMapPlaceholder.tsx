import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import {
  CurrentAnchor,
  FloorCode,
  IndoorDestination,
  MapPoint,
} from '../data/mockIndoorDestinations';
import {getRouteSegmentForFloor} from '../data/mockRoutes';
import type {NavigationRoute, RoutePosition} from '../data/mockRoutes';
import { radii } from '../theme/tokens';
import Boelter6FMap from '../../assets/maps/boelter-6f.svg';
import Boelter8FMap from '../../assets/maps/boelter-8f.svg';
import Svg, {Circle, G, Path, Polygon} from 'react-native-svg';

interface Props {
  floor: FloorCode;
  currentAnchor: CurrentAnchor;
  destination: IndoorDestination | null;
  zoneName: string;
  showRooms?: boolean;
  isNavigating: boolean;
  routeProgress: number;
  navigationRoute?: NavigationRoute | null;
  routePosition?: RoutePosition | null;
  style?: StyleProp<ViewStyle>;
  onInteractionStart?: () => void;
  focusPoint?: MapPoint | null;
  focusRequest?: number;
  focusZoom?: number;
}

const MAP_FIT_PADDING = 72;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const SVG_RENDER_ZOOM = MAX_ZOOM;
const DEFAULT_FOCUS_ZOOM = 3.2;
const FOCUS_ANIMATION_MS = 900;
const PINCH_ZOOM_RESPONSE = 0.68;
const ROTATION_DEAD_ZONE_RAD = Math.PI / 12;
const ROTATION_RESPONSE = 0.55;
const ROUTE_STROKE_WIDTH = 18;
const ROUTE_ARROW_SIZE = 50;

const floorMapComponents = {
  '6F': Boelter6FMap,
  '8F': Boelter8FMap,
};

const floorMapAspectRatios: Record<FloorCode, number> = {
  '6F': 880 / 1080,
  '8F': 880 / 1080,
};

interface GesturePoint {
  x: number;
  y: number;
}

interface MapViewState {
  translateX: number;
  translateY: number;
  zoom: number;
  rotation: number;
}

interface GestureStart {
  mode: 'none' | 'pan' | 'pinch';
  point: GesturePoint;
  center: GesturePoint;
  distance: number;
  angle: number;
  viewState: MapViewState;
}

const initialViewState: MapViewState = {
  translateX: 0,
  translateY: 0,
  zoom: 1,
  rotation: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTouchPoint(event: GestureResponderEvent): GesturePoint {
  const touch = event.nativeEvent.touches[0] ?? event.nativeEvent;

  return {
    x: touch.pageX,
    y: touch.pageY,
  };
}

function getTouchCenter(event: GestureResponderEvent): GesturePoint {
  const [firstTouch, secondTouch] = event.nativeEvent.touches;

  return {
    x: (firstTouch.pageX + secondTouch.pageX) / 2,
    y: (firstTouch.pageY + secondTouch.pageY) / 2,
  };
}

function getTouchDistance(event: GestureResponderEvent) {
  const [firstTouch, secondTouch] = event.nativeEvent.touches;
  const xDistance = secondTouch.pageX - firstTouch.pageX;
  const yDistance = secondTouch.pageY - firstTouch.pageY;

  return Math.sqrt(xDistance * xDistance + yDistance * yDistance);
}

function getTouchAngle(event: GestureResponderEvent) {
  const [firstTouch, secondTouch] = event.nativeEvent.touches;

  return Math.atan2(
    secondTouch.pageY - firstTouch.pageY,
    secondTouch.pageX - firstTouch.pageX
  );
}

function getMapTransform(viewState: MapViewState) {
  return [
    {translateX: viewState.translateX},
    {translateY: viewState.translateY},
    {rotate: `${viewState.rotation}rad`},
    {scale: viewState.zoom / SVG_RENDER_ZOOM},
  ];
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function normalizeAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function getDampedRotationDelta(angleDelta: number) {
  const normalizedAngleDelta = normalizeAngle(angleDelta);
  const absoluteAngleDelta = Math.abs(normalizedAngleDelta);

  if (absoluteAngleDelta <= ROTATION_DEAD_ZONE_RAD) {
    return 0;
  }

  return (
    Math.sign(normalizedAngleDelta) *
    (absoluteAngleDelta - ROTATION_DEAD_ZONE_RAD) *
    ROTATION_RESPONSE
  );
}

export function IndoorMapPlaceholder({
  floor,
  isNavigating,
  navigationRoute = null,
  routePosition = null,
  style,
  onInteractionStart,
  focusPoint,
  focusRequest = 0,
  focusZoom = DEFAULT_FOCUS_ZOOM,
}: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [frameSize, setFrameSize] = useState({
    width: windowWidth,
    height: windowHeight,
  });
  const aspectRatio = floorMapAspectRatios[floor];
  const availableWidth = Math.max(frameSize.width - MAP_FIT_PADDING * 2, 1);
  const availableHeight = Math.max(frameSize.height - MAP_FIT_PADDING * 2, 1);
  const widthConstrainedHeight = availableWidth / aspectRatio;
  const heightConstrainedWidth = availableHeight * aspectRatio;
  const mapWidth =
    widthConstrainedHeight <= availableHeight
      ? availableWidth
      : heightConstrainedWidth;
  const mapHeight = mapWidth / aspectRatio;
  const FloorMap = floorMapComponents[floor];
  const mapSurfaceRef = useRef<View | null>(null);
  const viewStateRef = useRef<MapViewState>(initialViewState);
  const focusAnimationRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const lastFocusRequestRef = useRef(0);
  const gestureStart = useRef<GestureStart>({
    mode: 'none',
    point: {x: 0, y: 0},
    center: {x: 0, y: 0},
    distance: 1,
    angle: 0,
    viewState: initialViewState,
  });
  const renderedMapWidth = mapWidth * SVG_RENDER_ZOOM;
  const renderedMapHeight = mapHeight * SVG_RENDER_ZOOM;
  const routeSegment = navigationRoute
    ? getRouteSegmentForFloor(navigationRoute, floor)
    : null;

  const getRenderedMapPoint = (point: MapPoint) => ({
    x: (point.x / 100) * renderedMapWidth,
    y: (point.y / 100) * renderedMapHeight,
  });

  const routePath =
    routeSegment?.points
      .map((point, index) => {
        const renderedPoint = getRenderedMapPoint(point);
        return `${index === 0 ? 'M' : 'L'} ${renderedPoint.x} ${
          renderedPoint.y
        }`;
      })
      .join(' ') ?? '';
  const routePointerPoint =
    isNavigating && routePosition?.floor === floor
      ? getRenderedMapPoint(routePosition.point)
      : null;
  const routePointerRotation =
    routePosition?.headingRadians === undefined
      ? 0
      : (routePosition.headingRadians * 180) / Math.PI;

  const updateViewState = useCallback((nextViewState: MapViewState) => {
    viewStateRef.current = nextViewState;
    mapSurfaceRef.current?.setNativeProps({
      style: {
        transform: getMapTransform(nextViewState),
      },
    });
  }, []);

  const cancelFocusAnimation = useCallback(() => {
    if (focusAnimationRef.current !== null) {
      cancelAnimationFrame(focusAnimationRef.current);
      focusAnimationRef.current = null;
    }
  }, []);

  const animateViewState = useCallback((targetViewState: MapViewState) => {
    cancelFocusAnimation();

    const startedAt = Date.now();
    const startViewState = viewStateRef.current;

    const step = () => {
      const elapsed = Date.now() - startedAt;
      const progress = easeOutCubic(clamp(elapsed / FOCUS_ANIMATION_MS, 0, 1));

      updateViewState({
        translateX: interpolate(
          startViewState.translateX,
          targetViewState.translateX,
          progress
        ),
        translateY: interpolate(
          startViewState.translateY,
          targetViewState.translateY,
          progress
        ),
        zoom: interpolate(startViewState.zoom, targetViewState.zoom, progress),
        rotation: interpolate(
          startViewState.rotation,
          targetViewState.rotation,
          progress
        ),
      });

      if (progress < 1) {
        focusAnimationRef.current = requestAnimationFrame(step);
        return;
      }

      focusAnimationRef.current = null;
    };

    focusAnimationRef.current = requestAnimationFrame(step);
  }, [cancelFocusAnimation, updateViewState]);

  const getFocusedViewState = useCallback((mapPoint: MapPoint): MapViewState => {
    const nextZoom = clamp(focusZoom, MIN_ZOOM, MAX_ZOOM);
    const pointOffsetX = (mapPoint.x / 100 - 0.5) * mapWidth * nextZoom;
    const pointOffsetY = (mapPoint.y / 100 - 0.5) * mapHeight * nextZoom;

    return {
      translateX: -pointOffsetX,
      translateY: -pointOffsetY,
      zoom: nextZoom,
      rotation: 0,
    };
  }, [focusZoom, mapHeight, mapWidth]);

  const handleFrameLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;

    setFrameSize((currentSize) => {
      const widthChanged = Math.abs(currentSize.width - width) > 1;
      const heightChanged = Math.abs(currentSize.height - height) > 1;

      return widthChanged || heightChanged ? { width, height } : currentSize;
    });
  };

  const mapPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (event, gestureState) =>
        event.nativeEvent.touches.length > 1 ||
        Math.abs(gestureState.dx) > 2 ||
        Math.abs(gestureState.dy) > 2,
      onPanResponderGrant: (event) => {
        cancelFocusAnimation();
        const touches = event.nativeEvent.touches;

        if (touches.length > 1) {
          gestureStart.current = {
            mode: 'pinch',
            point: {x: 0, y: 0},
            center: getTouchCenter(event),
            distance: getTouchDistance(event),
            angle: getTouchAngle(event),
            viewState: viewStateRef.current,
          };
          return;
        }

        gestureStart.current = {
          mode: 'pan',
          point: getTouchPoint(event),
          center: {x: 0, y: 0},
          distance: 1,
          angle: 0,
          viewState: viewStateRef.current,
        };
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;

        if (touches.length > 1) {
          const nextCenter = getTouchCenter(event);
          const nextDistance = getTouchDistance(event);
          const nextAngle = getTouchAngle(event);

          if (gestureStart.current.mode !== 'pinch') {
            gestureStart.current = {
              mode: 'pinch',
              point: {x: 0, y: 0},
              center: nextCenter,
              distance: nextDistance,
              angle: nextAngle,
              viewState: viewStateRef.current,
            };
          }

          const start = gestureStart.current;
          const safeStartDistance = Math.max(start.distance, 1);
          const distanceRatio = Math.max(nextDistance / safeStartDistance, 0.01);
          const nextZoom = clamp(
            start.viewState.zoom * Math.pow(distanceRatio, PINCH_ZOOM_RESPONSE),
            MIN_ZOOM,
            MAX_ZOOM
          );
          const rotationDelta = getDampedRotationDelta(nextAngle - start.angle);

          updateViewState({
            translateX:
              start.viewState.translateX + nextCenter.x - start.center.x,
            translateY:
              start.viewState.translateY + nextCenter.y - start.center.y,
            zoom: nextZoom,
            rotation: start.viewState.rotation + rotationDelta,
          });
          return;
        }

        const nextPoint = getTouchPoint(event);

        if (gestureStart.current.mode !== 'pan') {
          gestureStart.current = {
            mode: 'pan',
            point: nextPoint,
            center: {x: 0, y: 0},
            distance: 1,
            angle: 0,
            viewState: viewStateRef.current,
          };
        }

        const start = gestureStart.current;

        updateViewState({
          ...start.viewState,
          translateX:
            start.viewState.translateX + nextPoint.x - start.point.x,
          translateY:
            start.viewState.translateY + nextPoint.y - start.point.y,
        });
      },
      onPanResponderRelease: () => {
        gestureStart.current.mode = 'none';
      },
      onPanResponderTerminate: () => {
        gestureStart.current.mode = 'none';
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  useEffect(() => {
    cancelFocusAnimation();
    updateViewState(initialViewState);
  }, [cancelFocusAnimation, floor, mapHeight, mapWidth, updateViewState]);

  useEffect(() => {
    if (
      !focusPoint ||
      focusRequest <= 0 ||
      focusRequest === lastFocusRequestRef.current
    ) {
      return;
    }

    lastFocusRequestRef.current = focusRequest;
    animateViewState(getFocusedViewState(focusPoint));
  }, [
    animateViewState,
    floor,
    focusPoint,
    focusRequest,
    getFocusedViewState,
    mapHeight,
    mapWidth,
  ]);

  useEffect(() => cancelFocusAnimation, [cancelFocusAnimation]);

  return (
    <View
      style={[styles.mapFrame, style]}
      onLayout={handleFrameLayout}
      onTouchStart={onInteractionStart}
      {...mapPanResponder.panHandlers}
    >
      <View
        ref={mapSurfaceRef}
        style={[
          styles.mapSurface,
          {
            height: renderedMapHeight,
            transform: getMapTransform(viewStateRef.current),
            width: renderedMapWidth,
          },
        ]}
      >
        <FloorMap
          height={renderedMapHeight}
          preserveAspectRatio="xMidYMid meet"
          width={renderedMapWidth}
        />
        {isNavigating && routePath ? (
          <Svg
            height={renderedMapHeight}
            pointerEvents="none"
            style={styles.routeOverlay}
            width={renderedMapWidth}
          >
            <Path
              d={routePath}
              fill="none"
              opacity={0.28}
              stroke="#A7D8D0"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={ROUTE_STROKE_WIDTH + 20}
            />
            <Path
              d={routePath}
              fill="none"
              opacity={0.9}
              stroke="#2F7E73"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={ROUTE_STROKE_WIDTH}
            />
            {routePointerPoint ? (
              <G
                transform={`translate(${routePointerPoint.x} ${routePointerPoint.y}) rotate(${routePointerRotation})`}
              >
                <Circle fill="#FFFFFF" r={ROUTE_ARROW_SIZE * 0.62} />
                <Circle fill="#2F7E73" r={ROUTE_ARROW_SIZE * 0.48} />
                <Polygon
                  fill="#FFFFFF"
                  points={`${ROUTE_ARROW_SIZE * 0.35},0 ${-ROUTE_ARROW_SIZE * 0.22},${-ROUTE_ARROW_SIZE * 0.24} ${-ROUTE_ARROW_SIZE * 0.08},0 ${-ROUTE_ARROW_SIZE * 0.22},${ROUTE_ARROW_SIZE * 0.24}`}
                />
              </G>
            ) : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapFrame: {
    flex: 1,
    borderRadius: radii.lg,
    backgroundColor: '#EDF3F1',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mapSurface: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  routeOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
