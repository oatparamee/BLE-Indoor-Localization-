import React, { useRef, useState } from 'react';
import {
  GestureResponderEvent,
  PanResponder,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import {
  CurrentAnchor,
  floorLayouts,
  IndoorDestination,
  MapPoint,
} from '../data/mockIndoorDestinations';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  floor: 'L1' | 'L2' | 'L3';
  currentAnchor: CurrentAnchor;
  destination: IndoorDestination | null;
  zoneName: string;
  showRooms?: boolean;
  isNavigating: boolean;
  routeProgress: number;
  style?: StyleProp<ViewStyle>;
}

interface GesturePoint {
  x: number;
  y: number;
}

interface MapTransform {
  translateX: number;
  translateY: number;
  scale: number;
  rotation: number;
}

interface GestureStart {
  mode: 'none' | 'pan' | 'pinch';
  point: GesturePoint;
  center: GesturePoint;
  distance: number;
  angle: number;
  transform: MapTransform;
}

const MIN_SCALE = 0.75;
const MAX_SCALE = 3;

const initialTransform: MapTransform = {
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotation: 0,
};

function buildRoutePoints(start: MapPoint, destination: MapPoint): MapPoint[] {
  const corridorY = start.y > destination.y ? 58 : 68;

  return [
    { x: start.x, y: start.y },
    { x: start.x, y: corridorY },
    { x: 49, y: corridorY },
    { x: 49, y: destination.y },
    { x: destination.x, y: destination.y },
  ];
}

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

export function IndoorMapPlaceholder({
  floor,
  currentAnchor,
  destination,
  zoneName,
  showRooms = true,
  isNavigating,
  routeProgress,
  style,
}: Props) {
  const rooms = showRooms ? floorLayouts[floor] : [];
  const [mapTransform, setMapTransform] = useState<MapTransform>(initialTransform);
  const mapTransformRef = useRef<MapTransform>(initialTransform);
  const gestureStart = useRef<GestureStart>({
    mode: 'none',
    point: { x: 0, y: 0 },
    center: { x: 0, y: 0 },
    distance: 1,
    angle: 0,
    transform: initialTransform,
  });
  const routePoints = destination
    ? buildRoutePoints(currentAnchor.point, destination.mapPoint)
    : [];
  const completedSegmentCount =
    destination && isNavigating
      ? Math.max(1, Math.round((routeProgress / 100) * (routePoints.length - 1)))
      : Math.max(routePoints.length - 1, 0);
  const updateMapTransform = (nextTransform: MapTransform) => {
    mapTransformRef.current = nextTransform;
    setMapTransform(nextTransform);
  };
  const mapPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (event, gestureState) =>
        event.nativeEvent.touches.length > 1 ||
        Math.abs(gestureState.dx) > 3 ||
        Math.abs(gestureState.dy) > 3,
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches;

        if (touches.length > 1) {
          gestureStart.current = {
            mode: 'pinch',
            point: { x: 0, y: 0 },
            center: getTouchCenter(event),
            distance: getTouchDistance(event),
            angle: getTouchAngle(event),
            transform: mapTransformRef.current,
          };
          return;
        }

        gestureStart.current = {
          mode: 'pan',
          point: getTouchPoint(event),
          center: { x: 0, y: 0 },
          distance: 1,
          angle: 0,
          transform: mapTransformRef.current,
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
              point: { x: 0, y: 0 },
              center: nextCenter,
              distance: nextDistance,
              angle: nextAngle,
              transform: mapTransformRef.current,
            };
          }

          const start = gestureStart.current;
          const safeStartDistance = Math.max(start.distance, 1);

          updateMapTransform({
            translateX: start.transform.translateX + nextCenter.x - start.center.x,
            translateY: start.transform.translateY + nextCenter.y - start.center.y,
            scale: clamp(
              start.transform.scale * (nextDistance / safeStartDistance),
              MIN_SCALE,
              MAX_SCALE
            ),
            rotation: start.transform.rotation + nextAngle - start.angle,
          });
          return;
        }

        const nextPoint = getTouchPoint(event);

        if (gestureStart.current.mode !== 'pan') {
          gestureStart.current = {
            mode: 'pan',
            point: nextPoint,
            center: { x: 0, y: 0 },
            distance: 1,
            angle: 0,
            transform: mapTransformRef.current,
          };
        }

        const start = gestureStart.current;

        updateMapTransform({
          ...start.transform,
          translateX: start.transform.translateX + nextPoint.x - start.point.x,
          translateY: start.transform.translateY + nextPoint.y - start.point.y,
        });
      },
      onPanResponderRelease: () => {
        gestureStart.current.mode = 'none';
      },
      onPanResponderTerminate: () => {
        gestureStart.current.mode = 'none';
      },
    })
  ).current;

  return (
    <View style={[styles.mapFrame, style]} {...mapPanResponder.panHandlers}>
      <View style={styles.mapHud}>
        <View style={styles.mapHudCard}>
          <Text style={styles.mapHudLabel}>Drag, pinch, rotate</Text>
          <Text style={styles.mapHudValue}>{zoneName}</Text>
        </View>
        <View style={styles.compassCard}>
          <Text style={styles.compassText}>N</Text>
        </View>
      </View>

      <View style={styles.levelBadge}>
        <Text style={styles.levelBadgeText}>Level {floor.slice(1)}</Text>
      </View>

      <View
        style={[
          styles.mapContent,
          {
            transform: [
              { translateX: mapTransform.translateX },
              { translateY: mapTransform.translateY },
              { scale: mapTransform.scale },
              { rotate: `${mapTransform.rotation}rad` },
            ],
          },
        ]}
      >
        <View style={styles.gridPattern}>
          {Array.from({ length: 7 }).map((_, index) => (
            <View
              key={`row-${index}`}
              style={[styles.gridLineHorizontal, { top: `${index * 16}%` }]}
            />
          ))}
          {Array.from({ length: 6 }).map((_, index) => (
            <View
              key={`column-${index}`}
              style={[styles.gridLineVertical, { left: `${index * 18}%` }]}
            />
          ))}
        </View>

        <View style={styles.corridorVertical} />
        <View style={styles.corridorHorizontal} />

        {rooms.map((room) => (
          <View
            key={room.id}
            style={[
              styles.room,
              room.tone === 'primary' && styles.roomPrimary,
              room.tone === 'accent' && styles.roomAccent,
              {
                left: room.left as `${number}%`,
                top: room.top as `${number}%`,
                width: room.width as `${number}%`,
                height: room.height as `${number}%`,
              },
            ]}
          >
            <Text style={styles.roomLabel}>{room.label}</Text>
          </View>
        ))}

        {destination
          ? routePoints.slice(0, -1).map((point, index) => {
              const nextPoint = routePoints[index + 1];
              const horizontal = point.y === nextPoint.y;
              const completed = index < completedSegmentCount;

              return (
                <View
                  key={`segment-${index}`}
                  style={[
                    styles.routeSegment,
                    horizontal ? styles.routeHorizontal : styles.routeVertical,
                    completed ? styles.routeSegmentComplete : styles.routeSegmentPending,
                    horizontal
                      ? {
                          left: `${Math.min(point.x, nextPoint.x)}%`,
                          top: `${point.y}%`,
                          width: `${Math.abs(nextPoint.x - point.x)}%`,
                        }
                      : {
                          left: `${point.x}%`,
                          top: `${Math.min(point.y, nextPoint.y)}%`,
                          height: `${Math.abs(nextPoint.y - point.y)}%`,
                        },
                  ]}
                />
              );
            })
          : null}

        <View
          style={[
            styles.startHalo,
            isNavigating && styles.startHaloActive,
            {
              left: `${currentAnchor.point.x - 4.5}%`,
              top: `${currentAnchor.point.y - 5.5}%`,
            },
          ]}
        />

        <View
          style={[
            styles.startMarker,
            {
              left: `${currentAnchor.point.x - 2}%`,
              top: `${currentAnchor.point.y - 3}%`,
            },
          ]}
        >
          <Text style={styles.markerText}>You</Text>
        </View>

        {destination ? (
          <View
            style={[
              styles.destinationMarker,
              {
                left: `${destination.mapPoint.x - 2}%`,
                top: `${destination.mapPoint.y - 7}%`,
              },
            ]}
          >
            <Text style={styles.markerText}>Go</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={styles.legendStartDot} />
          <Text style={styles.legendText}>Current BLE fix</Text>
        </View>
        {destination ? (
          <View style={styles.legendRow}>
            <View style={styles.legendDestinationDot} />
            <Text style={styles.legendText}>Destination</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapFrame: {
    flex: 1,
    borderRadius: radii.lg,
    backgroundColor: '#F9FBFD',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    overflow: 'hidden',
  },
  mapHud: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    zIndex: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  mapHudCard: {
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  mapHudLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
  },
  mapHudValue: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  compassCard: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassText: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.surface,
  },
  levelBadge: {
    position: 'absolute',
    top: 76,
    left: spacing.md,
    zIndex: 2,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
  },
  levelBadgeText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  mapContent: {
    ...StyleSheet.absoluteFillObject,
  },
  gridPattern: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#E8EEF3',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#E8EEF3',
  },
  corridorVertical: {
    position: 'absolute',
    left: '44%',
    top: '10%',
    width: '14%',
    height: '76%',
    borderRadius: 24,
    backgroundColor: '#EEF3F7',
    borderWidth: 1,
    borderColor: '#DAE5ED',
  },
  corridorHorizontal: {
    position: 'absolute',
    left: '14%',
    top: '54%',
    width: '72%',
    height: '14%',
    borderRadius: 24,
    backgroundColor: '#EEF3F7',
    borderWidth: 1,
    borderColor: '#DAE5ED',
  },
  room: {
    position: 'absolute',
    borderRadius: radii.md,
    padding: spacing.sm,
    justifyContent: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE5EC',
  },
  roomPrimary: {
    backgroundColor: '#E3F3EE',
    borderColor: '#BDE0D5',
  },
  roomAccent: {
    backgroundColor: '#EEF5FF',
    borderColor: '#CBDAF0',
  },
  roomLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  routeSegment: {
    position: 'absolute',
    borderRadius: 999,
  },
  routeSegmentComplete: {
    backgroundColor: colors.accentStrong,
  },
  routeSegmentPending: {
    backgroundColor: '#BFD4D1',
  },
  routeHorizontal: {
    height: 6,
  },
  routeVertical: {
    width: 6,
  },
  startHalo: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(17,94,89,0.08)',
  },
  startHaloActive: {
    backgroundColor: 'rgba(17,94,89,0.16)',
  },
  startMarker: {
    position: 'absolute',
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textPrimary,
  },
  destinationMarker: {
    position: 'absolute',
    minWidth: 42,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentStrong,
  },
  markerText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.surface,
  },
  legend: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#DCE5EC',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendStartDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textPrimary,
  },
  legendDestinationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accentStrong,
  },
  legendText: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
});
