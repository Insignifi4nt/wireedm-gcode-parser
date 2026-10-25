mod common;

use common::Builder;
use sketch_solver::diagnose::{self, CONFLICTING, REDUNDANT};
use sketch_solver::equations::Kind;
use sketch_solver::problem::Status;

#[test]
fn a_redundant_direction_of_another_form_does_not_move_free_midpoints() {
    // A right angle and a perpendicular relation from a fixed line to a free one, far from the origin.
    // Their rows are proportional but their residuals differ before convergence; solved together
    // in the damped factor they moved the midpoint of the free line by 24 units in the last place.
    let o = 9e8;
    for angle_first in [true, false] {
        let mut builder = Builder::new();
        let a = builder.point(o, o, true);
        let b = builder.point(o + 10.0, o + 5.0, true);
        let c = builder.point(o + 2.0, o + 5.0, false);
        let d = builder.point(o + 1.0, o + 5.4, false);
        let lines = [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
        let angle = |builder: &mut Builder| builder.equation(Kind::Angle, std::f64::consts::FRAC_PI_2, &lines);
        if angle_first { angle(&mut builder); }
        builder.equation(Kind::Perpendicular, 0.0, &lines);
        if !angle_first { angle(&mut builder); }
        let start = builder.values.clone();
        let (outcome, values) = builder.outcome();
        assert_eq!((outcome.status, outcome.labels), (Status::Converged, vec![0, REDUNDANT]), "angle first: {angle_first}");
        // Within a unit in the last place of the coordinates.
        for axis in 0..2 {
            let moved = (values[c[axis]] + values[d[axis]] - start[c[axis]] - start[d[axis]]) / 2.0;
            assert!(moved.abs() <= o * f64::EPSILON, "angle first: {angle_first}, midpoint moved {moved}");
        }
    }
}

#[test]
fn dimensions_left_out_unsatisfied_are_solved_again_with_every_row() {
    // The second distance depends on the first at the start, so the first solve meets 5 alone;
    // 6 is not met there, so the group is solved again from the start to the nearest compromise.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(4.0, 3.0, false);
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    builder.equation(Kind::Distance, 6.0, &[a[0], a[1], b[0], b[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!(outcome.status, Status::NotConverged);
    assert!((values[b[0]].hypot(values[b[1]]) - 5.5).abs() < 1e-9, "{:?}", &values[b[0]..]);
    assert_eq!(outcome.labels, vec![0, CONFLICTING, CONFLICTING]);
}

#[test]
fn a_start_between_two_centres_keeps_the_result_of_solving_every_row() {
    // Two distances of 6 from centres 10 apart. On the line through the centres their rows are
    // parallel, although they are independent at both intersections. Leaving one out at the start
    // cannot meet the other, so the group is solved with both: from exactly on the line no step
    // leaves it, and the nearest compromise is the midpoint. A start just off the line, around
    // the dependence tolerance, reaches the intersection on its side.
    for (y, expected) in [(0.0, (5.0, 0.0)), (1e-10, (5.0, 11f64.sqrt())), (4e-10, (5.0, 11f64.sqrt())), (-1e-6, (5.0, -11f64.sqrt()))] {
        let mut builder = Builder::new();
        let left = builder.point(0.0, 0.0, true);
        let right = builder.point(10.0, 0.0, true);
        let p = builder.point(4.0, y, false);
        builder.equation(Kind::Distance, 6.0, &[left[0], left[1], p[0], p[1]]);
        builder.equation(Kind::Distance, 6.0, &[right[0], right[1], p[0], p[1]]);
        let (outcome, values) = builder.outcome();
        assert_eq!(outcome.status == Status::Converged, expected.1 != 0.0, "y {y}");
        assert!((values[p[0]] - expected.0).abs() < 1e-9 && (values[p[1]] - expected.1).abs() < 1e-9, "y {y}: {:?}", &values[p[0]..]);
    }
}

#[test]
fn drag_targets_stay_in_the_solve() {
    // A point on a steep fixed line dragged toward a cursor off it: the targets are not diagnosed,
    // so neither is left out, and the point settles halfway between the cursor and its foot.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1.0, 5.0, true);
    let p = builder.point(0.2, 1.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 7.0, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (_, values) = builder.outcome();
    let normal = [5.0 / 26f64.sqrt(), -1.0 / 26f64.sqrt()];
    let offset = (normal[0] * 7.0 + normal[1] * 1.0) / 2.0;
    let expected = [7.0 - offset * normal[0], 1.0 - offset * normal[1]];
    assert!((values[p[0]] - expected[0]).abs() < 1e-9 && (values[p[1]] - expected[1]).abs() < 1e-9, "{:?} {expected:?}", &values[p[0]..]);
}

#[test]
fn a_witness_keeps_every_row_its_contradiction_needs() {
    // x = 0, y = 0 and x + 5e-10 y = 1 contradict only together: the y coefficient is larger
    // than the dependence tolerance, so it stays in the witness.
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let rows = [row(vec![(0, 1.0)], 0.0), row(vec![(1, 1.0)], 0.0), row(vec![(0, 1.0), (1, 5e-10)], -1.0)];
    let diagnosis = diagnose::diagnose(2, &rows, diagnose::TAU, usize::MAX).0.unwrap();
    assert_eq!(diagnosis.rank, 2);
    assert_eq!(diagnosis.witnesses.iter().map(|w| (w.rows.clone(), w.agrees)).collect::<Vec<_>>(), vec![(vec![0, 1, 2], false)]);
}
