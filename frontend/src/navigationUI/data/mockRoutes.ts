import type {FloorCode, MapPoint} from './mockIndoorDestinations';

export interface NavigationRouteSegment {
  floor: FloorCode;
  points: MapPoint[];
}

export interface NavigationRoute {
  id: string;
  name: string;
  segments: NavigationRouteSegment[];
}

export interface RoutePosition {
  floor: FloorCode;
  point: MapPoint;
  headingRadians: number;
}

export const boelterDemoRoute: NavigationRoute = {
  id: 'boelter-6266-to-engineering-library',
  name: 'Boelter 6266 Suite to Engineering Library',
  segments: [
    {
      floor: '6F',
      points: [
        {x: 87.5, y: 18.1},
        {x: 82.0, y: 18.1},
        {x: 82.0, y: 25.6},
        {x: 76.2, y: 25.6},
      ],
    },
    {
      floor: '8F',
      points: [
        {x: 66.3, y: 34.8},
        {x: 66.3, y: 45.8},
        {x: 66.3, y: 66.7},
        {x: 69.1, y: 68.5},
      ],
    },
  ],
};

const clampProgress = (progressPercent: number) =>
  Math.min(100, Math.max(0, progressPercent));

const getDistance = (start: MapPoint, end: MapPoint) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const getTotalRouteLength = (route: NavigationRoute) =>
  route.segments.reduce((routeTotal, segment) => {
    const segmentTotal = segment.points.reduce((total, point, index) => {
      if (index === 0) {
        return total;
      }
      return total + getDistance(segment.points[index - 1], point);
    }, 0);

    return routeTotal + segmentTotal;
  }, 0);

export const getRouteSegmentForFloor = (
  route: NavigationRoute,
  floor: FloorCode,
) => route.segments.find(segment => segment.floor === floor) ?? null;

export const getRoutePositionAtProgress = (
  route: NavigationRoute,
  progressPercent: number,
): RoutePosition => {
  const totalLength = getTotalRouteLength(route);
  const fallbackSegment = route.segments[0];
  const fallbackPoint = fallbackSegment.points[0];

  if (totalLength <= 0) {
    return {
      floor: fallbackSegment.floor,
      point: fallbackPoint,
      headingRadians: 0,
    };
  }

  const targetLength = totalLength * (clampProgress(progressPercent) / 100);
  let traveledLength = 0;

  for (const segment of route.segments) {
    for (let index = 1; index < segment.points.length; index += 1) {
      const start = segment.points[index - 1];
      const end = segment.points[index];
      const segmentLength = getDistance(start, end);

      if (targetLength <= traveledLength + segmentLength) {
        const segmentProgress =
          segmentLength === 0
            ? 0
            : (targetLength - traveledLength) / segmentLength;

        return {
          floor: segment.floor,
          point: {
            x: start.x + (end.x - start.x) * segmentProgress,
            y: start.y + (end.y - start.y) * segmentProgress,
          },
          headingRadians: Math.atan2(end.y - start.y, end.x - start.x),
        };
      }

      traveledLength += segmentLength;
    }
  }

  const lastSegment = route.segments[route.segments.length - 1];
  const lastPoint = lastSegment.points[lastSegment.points.length - 1];
  const previousPoint =
    lastSegment.points[lastSegment.points.length - 2] ?? lastPoint;

  return {
    floor: lastSegment.floor,
    point: lastPoint,
    headingRadians: Math.atan2(
      lastPoint.y - previousPoint.y,
      lastPoint.x - previousPoint.x,
    ),
  };
};
