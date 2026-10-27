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
fn a_witness_keeps_every_row_its_contradiction_needs() {
    // x = 0, y = 0 and x + 5e-10 y = 1 contradict only together: the y coefficient is larger
    // than the dependence tolerance, so it stays in the witness.
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let rows = [row(vec![(0, 1.0)], 0.0), row(vec![(1, 1.0)], 0.0), row(vec![(0, 1.0), (1, 5e-10)], -1.0)];
    let diagnosis = diagnose::diagnose(2, &rows, diagnose::TAU, usize::MAX, usize::MAX).0.unwrap();
    assert_eq!(diagnosis.rank, 2);
    assert_eq!(diagnosis.witnesses.iter().map(|w| (w.rows.clone(), w.agrees)).collect::<Vec<_>>(), vec![(vec![0, 1, 2], false)]);
}

#[test]
fn a_witness_keeps_a_row_whose_removal_cancellation_hides() {
    // x + z = 0, x + 1e-6 y + z = 0, z = 0 and y + 1e-9 z = 1 contradict only together: without
    // z = 0 the others hold at (-1e9, 0, 1e9). The rest miss the last row by 1e-9 in z, where
    // their terms of about 1e6 cancel and roundoff could hide it, so z = 0 stays.
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let rows = [
        row(vec![(0, 1.0), (2, 1.0)], 0.0),
        row(vec![(0, 1.0), (1, 1e-6), (2, 1.0)], 0.0),
        row(vec![(2, 1.0)], 0.0),
        row(vec![(1, 1.0), (2, 1e-9)], -1.0),
    ];
    let diagnosis = diagnose::diagnose(3, &rows, diagnose::TAU, usize::MAX, usize::MAX).0.unwrap();
    assert_eq!(diagnosis.rank, 3);
    assert_eq!(diagnosis.witnesses.iter().map(|w| (w.rows.clone(), w.agrees)).collect::<Vec<_>>(), vec![(vec![0, 1, 2, 3], false)]);
}

#[test]
fn a_witness_drops_a_row_the_others_reproduce_without() {
    // 2.7 r1 + 0.9 r2 reproduces the last row exactly, so r0 is not needed. The first two columns
    // of r1 and r2 are nearly parallel although the rows are not, so coefficients from the
    // factor's pivot columns cannot show that; a fit on the rows themselves does.
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let rows = [
        row(vec![(0, 1.0), (1, 1.0000005), (2, 1.0)], 0.0),
        row(vec![(0, 1.0), (1, 1.0), (2, 1.0)], 0.0),
        row(vec![(0, 1.0), (1, 1.0000001), (2, -1.0)], 0.0),
        row(vec![(0, 3.6), (1, 3.60000009), (2, 1.8000000000000003)], -1.0),
    ];
    let diagnosis = diagnose::diagnose(3, &rows, diagnose::TAU, usize::MAX, usize::MAX).0.unwrap();
    assert_eq!(diagnosis.rank, 3);
    assert_eq!(diagnosis.witnesses.iter().map(|w| (w.rows.clone(), w.agrees)).collect::<Vec<_>>(), vec![(vec![1, 2, 3], false)]);
}

/// x = 0, then rows of `x + 1.27e-10 (y + z)` with these residuals and signs. Their remainder past x
/// is about 0.9e-10 in each of y and z: each lead is within the dependence distance but together they
/// are not, so such a row is left out undecided.
fn copies(rows: &[(f64, f64)], last: Option<Vec<(usize, f64)>>) -> diagnose::Diagnosis {
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let mut built = vec![row(vec![(0, 1.0)], 0.0)];
    built.extend(rows.iter().map(|&(sign, residual)| row(vec![(0, sign), (1, sign * 1.27e-10), (2, sign * 1.27e-10)], residual)));
    if let Some(entries) = last { built.push(row(entries, 0.0)); }
    diagnose::diagnose(3, &built, diagnose::TAU, usize::MAX, usize::MAX).0.unwrap()
}

fn witnesses(diagnosis: &diagnose::Diagnosis) -> Vec<(Vec<usize>, bool)> { diagnosis.witnesses.iter().map(|w| (w.rows.clone(), w.agrees)).collect() }

#[test]
fn an_exact_copy_of_an_undecided_row_depends_on_it_alone() {
    let alone = copies(&[(1.0, 0.0)], None);
    assert_eq!((alone.rank, alone.certain, witnesses(&alone)), (1, false, vec![]));
    // Copied, negated, or repeated twice, each copy depends on the first and agrees with it.
    for (rows, expected) in [
        (vec![(1.0, 0.0), (1.0, 0.0)], vec![(vec![1, 2], true)]),
        (vec![(1.0, 2e-11), (-1.0, -2e-11)], vec![(vec![1, 2], true)]),
        (vec![(1.0, 0.0), (1.0, 0.0), (1.0, 0.0)], vec![(vec![1, 2], true), (vec![1, 3], true)]),
        // With another residual, it disagrees, past the rows' tolerances together.
        (vec![(1.0, 0.0), (1.0, 2.1e-10)], vec![(vec![1, 2], false)]),
        (vec![(1.0, 0.0), (1.0, 1.9e-10)], vec![(vec![1, 2], true)]),
    ] {
        let diagnosis = copies(&rows, None);
        assert_eq!((diagnosis.rank, diagnosis.certain, witnesses(&diagnosis)), (1, false, expected), "{rows:?}");
    }
    // A row one unit in the last place away is no copy, and is left out as well.
    let near = copies(&[(1.0, 0.0)], Some(vec![(0, 1.0), (1, 1.27e-10), (2, 1.2700000000000002e-10)]));
    assert_eq!((near.rank, near.certain, witnesses(&near)), (1, false, vec![]));
}

#[test]
fn a_copy_decided_on_its_own_keeps_its_own_witness() {
    // Once y is independent, the copy's remainder past it is decided in z, and it depends on its
    // first row's factor through the independent rows, as before.
    let row = |entries: Vec<(usize, f64)>, residual: f64| diagnose::Row { entries, residual, tolerance: 1e-10 };
    let copy = || row(vec![(0, 1.0), (1, 1.27e-10), (2, 1.27e-10)], 0.0);
    let rows = [row(vec![(0, 1.0)], 0.0), copy(), row(vec![(1, 1.0)], 0.0), copy()];
    let diagnosis = diagnose::diagnose(3, &rows, diagnose::TAU, usize::MAX, usize::MAX).0.unwrap();
    assert_eq!((diagnosis.rank, diagnosis.certain), (2, false));
    assert!(diagnosis.witnesses.iter().all(|w| w.rows.last() == Some(&3) && !w.rows.contains(&1)), "{:?}", witnesses(&diagnosis));
}
