declare module "clipper-lib" {
  interface IntPoint {
    X: number;
    Y: number;
  }

  type Path = IntPoint[];
  type Paths = Path[];

  const ClipType: {
    ctIntersection: 0;
    ctUnion: 1;
    ctDifference: 2;
    ctXor: 3;
  };

  const PolyType: {
    ptSubject: 0;
    ptClip: 1;
  };

  const PolyFillType: {
    pftEvenOdd: 0;
    pftNonZero: 1;
    pftPositive: 2;
    pftNegative: 3;
  };

  const JoinType: {
    jtSquare: 0;
    jtRound: 1;
    jtMiter: 2;
  };

  const EndType: {
    etOpenSquare: 0;
    etOpenRound: 1;
    etOpenButt: 2;
    etClosedLine: 3;
    etClosedPolygon: 4;
  };

  class Clipper {
    constructor(initOptions?: number);
    AddPath(path: Path, polyType: number, closed: boolean): boolean;
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(
      clipType: number,
      solution: Paths,
      subjFillType?: number,
      clipFillType?: number,
    ): boolean;
    static Area(poly: Path): number;
    static Orientation(poly: Path): boolean;
  }

  class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
    Clear(): void;
  }

  function IntPoint(x: number, y: number): IntPoint;

  const JS: {
    ScaleUpPath(path: Path, scale: number): void;
    ScaleUpPaths(paths: Paths, scale: number): void;
    ScaleDownPath(path: Path, scale: number): void;
    ScaleDownPaths(paths: Paths, scale: number): void;
    Clean(polygon: Paths, delta: number): Paths;
    Clone(polygon: Paths): Paths;
  };
}
