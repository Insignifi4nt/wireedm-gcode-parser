//! Scalar equation kinds. Operands are parameter values in a fixed order per kind; lengths
//! keep length units, directions are normalized and angles are radians.

use crate::dual::Dual;
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `b - a = value`
    Difference,
    /// `a = value`
    Value,
    /// `(a + b) / 2 = m` on one axis.
    Midpoint,
    /// `|q - p| = value`
    Distance,
    /// `|q - p| = r` for a radius parameter `r`.
    DistanceToParameter,
    /// Signed distance from `p` to the line through `a` and `b` is zero.
    PointOnLine,
    /// Normalized cross product of two directions is zero.
    Parallel,
    /// Normalized dot product of two directions is zero.
    Perpendicular,
    /// Signed angle from the first direction to the second minus `value`, wrapped to [-pi, pi).
    Angle,
    /// Two segment lengths are equal.
    EqualLength,
    /// The midpoint of `p` and `q` lies on the line through `a` and `b`.
    SymmetricMidpoint,
    /// `q - p` is perpendicular to the line through `a` and `b`, in length units.
    SymmetricPerpendicular,
}

impl Kind {
    pub const ALL: [Kind; 12] = [Kind::Difference, Kind::Value, Kind::Midpoint, Kind::Distance, Kind::DistanceToParameter,
        Kind::PointOnLine, Kind::Parallel, Kind::Perpendicular, Kind::Angle, Kind::EqualLength, Kind::SymmetricMidpoint,
        Kind::SymmetricPerpendicular];

    /// Wire code; the order of `ALL` is the protocol.
    pub fn from_code(code: f64) -> Option<Kind> {
        if code.fract() != 0.0 || code < 0.0 { return None; }
        Kind::ALL.get(code as usize).copied()
    }

    pub fn arity(self) -> usize {
        match self {
            Kind::Value => 1,
            Kind::Difference => 2,
            Kind::Midpoint => 3,
            Kind::Distance => 4,
            Kind::DistanceToParameter => 5,
            Kind::PointOnLine => 6,
            Kind::Parallel | Kind::Perpendicular | Kind::Angle | Kind::EqualLength | Kind::SymmetricMidpoint
            | Kind::SymmetricPerpendicular => 8,
        }
    }
}

fn length(x: Dual, y: Dual) -> Dual { (x * x + y * y).sqrt() }
fn cross(ax: Dual, ay: Dual, bx: Dual, by: Dual) -> Dual { ax * by - ay * bx }
fn dot(ax: Dual, ay: Dual, bx: Dual, by: Dual) -> Dual { ax * bx + ay * by }

/// Residual of one equation; `o` holds exactly `kind.arity()` operands.
pub fn residual(kind: Kind, o: &[Dual], value: f64) -> Dual {
    match kind {
        Kind::Difference => o[1] - o[0] - value,
        Kind::Value => o[0] - value,
        Kind::Midpoint => (o[0] + o[1]) * 0.5 - o[2],
        Kind::Distance => length(o[2] - o[0], o[3] - o[1]) - value,
        Kind::DistanceToParameter => length(o[2] - o[0], o[3] - o[1]) - o[4],
        Kind::PointOnLine => {
            let (dx, dy) = (o[4] - o[2], o[5] - o[3]);
            cross(dx, dy, o[0] - o[2], o[1] - o[3]) / length(dx, dy)
        }
        Kind::Parallel | Kind::Perpendicular | Kind::Angle | Kind::EqualLength => {
            let (ax, ay, bx, by) = (o[2] - o[0], o[3] - o[1], o[6] - o[4], o[7] - o[5]);
            match kind {
                Kind::Parallel => cross(ax, ay, bx, by) / (length(ax, ay) * length(bx, by)),
                Kind::Perpendicular => dot(ax, ay, bx, by) / (length(ax, ay) * length(bx, by)),
                Kind::Angle => {
                    let raw = cross(ax, ay, bx, by).atan2(dot(ax, ay, bx, by)) - value;
                    raw - ((raw.value + PI) / (2.0 * PI)).floor() * 2.0 * PI
                }
                _ => length(ax, ay) - length(bx, by),
            }
        }
        Kind::SymmetricMidpoint | Kind::SymmetricPerpendicular => {
            let (dx, dy) = (o[6] - o[4], o[7] - o[5]);
            if kind == Kind::SymmetricMidpoint {
                cross(dx, dy, (o[0] + o[2]) * 0.5 - o[4], (o[1] + o[3]) * 0.5 - o[5]) / length(dx, dy)
            } else {
                dot(dx, dy, o[2] - o[0], o[3] - o[1]) / length(dx, dy)
            }
        }
    }
}
