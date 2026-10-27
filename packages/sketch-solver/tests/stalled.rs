mod common;

use common::Builder;
use sketch_solver::diagnose::{CONFLICTING as C, REDUNDANT as R};
use sketch_solver::equations::Kind;
use sketch_solver::newton::{DragOutcome, Limits};
use sketch_solver::problem::{Diagnosis, Status};

/// `(status, diagnosis, degrees of freedom, labels)`
fn diagnose(builder: &Builder) -> (Status, Diagnosis, Option<usize>, Vec<u8>) {
    let (outcome, _) = builder.outcome();
    (outcome.status, outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels)
}

fn distance(builder: &mut Builder, value: f64, p: [usize; 2], q: [usize; 2]) {
    builder.equation(Kind::Distance, value, &[p[0], p[1], q[0], q[1]]);
}

/// Points a and b 10 apart on a horizontal, dimensioned 10, 12 and 14 apart, the 12 from b to a,
/// and 20 apart vertically.
fn overlapping() -> (Builder, [usize; 2], [usize; 2]) {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    let b = builder.point(10.0, 0.0, false);
    distance(&mut builder, 10.0, a, b);
    distance(&mut builder, 12.0, b, a);
    distance(&mut builder, 14.0, a, b);
    builder.equation(Kind::Difference, 20.0, &[a[1], b[1]]);
    (builder, a, b)
}

#[test]
fn distances_and_an_offset_that_cannot_agree_are_blamed_as_their_start_shows() {
    // The nearest point stands the pair upright, which the solve approaches only linearly, so rank
    // there is unclear at the exact distance, and the looser one suspects all four. At the start the
    // distances, the same function of a and b with other values, repeat each other, so they are
    // blamed and the offset is not, as PlaneGCS diagnoses the start. Repeated, the 10 agrees and is
    // redundant, and so is the offset from b down to a, the same function negated. The values stay
    // where the solve stopped, upright at the mean of the dimensions.
    for repeat in [false, true] {
        let (mut builder, a, b) = overlapping();
        if repeat {
            distance(&mut builder, 10.0, a, b);
            builder.equation(Kind::Difference, -20.0, &[b[1], a[1]]);
        }
        let (outcome, values) = builder.outcome();
        let labels = if repeat { vec![C, C, C, 0, R, R] } else { vec![C, C, C, 0] };
        assert_eq!((outcome.status, outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels), (Status::NotConverged, Diagnosis::FromStart, None, labels), "repeat {repeat}");
        let upright = if repeat { (10.0 + 12.0 + 14.0 + 10.0 + 20.0 + 20.0) / 6.0 } else { 14.0 };
        assert!((values[b[0]] - values[a[0]]).abs() < 1e-6 && (values[b[1]] - values[a[1]] - upright).abs() < 1e-6, "{values:?}");
    }
}

#[test]
fn more_work_only_makes_a_stalled_diagnosis_more_definite() {
    // From the first limit that diagnoses the stall at all: unavailable, then suspected once the
    // looser diagnosis fits, then blamed from the start once its checks fit too, and never back.
    let (builder, _, _) = overlapping();
    let kinds: Vec<_> = (0..8000).map(|work| builder.outcome_within(Limits { fill: usize::MAX, work }).0.diagnosis).collect();
    let suspected = kinds.iter().position(|&kind| kind == Diagnosis::Suspected).unwrap();
    let blamed = kinds.iter().position(|&kind| kind == Diagnosis::FromStart).unwrap();
    assert!(suspected < blamed, "{suspected} {blamed}");
    assert!(kinds[..suspected].iter().all(|&kind| kind == Diagnosis::Unavailable));
    assert!(kinds[suspected..blamed].iter().all(|&kind| kind == Diagnosis::Suspected));
    assert!(kinds[blamed..].iter().all(|&kind| kind == Diagnosis::FromStart));
}

#[test]
fn a_drag_of_conflicting_dimensions_is_still_suspected() {
    // A drag has no start of its own to diagnose, and its diagnoses fall back anyway.
    let (mut builder, _, b) = overlapping();
    builder.temporary(Kind::Value, 3.0, &[b[0]]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.diagnosis, outcome.drag, outcome.labels), (Status::NotConverged, Diagnosis::Suspected, Some(DragOutcome::Stalled), vec![C, C, C, C, 0]));
}

#[test]
fn a_dependency_the_start_shows_by_accident_is_not_blamed() {
    // p 5 from both o and q, 8 apart, starting nearly on their line, where the two distances read as
    // repeating each other with other values. Alone they solve at (4, 3) or (4, -3), where they are
    // independent. Joined to r by conflicting distances and an offset, the start shows all four
    // dimensions dependent, but only r's are the same function, so only they are blamed, wherever p
    // starts.
    for (lift, joined, expected) in [
        (1e-11, false, (Status::Converged, Diagnosis::Diagnosed, Some(0), vec![0, 0])),
        (1e-11, true, (Status::NotConverged, Diagnosis::FromStart, None, vec![0, 0, C, C, 0])),
        (1.0, true, (Status::NotConverged, Diagnosis::FromStart, None, vec![0, 0, C, C, 0])),
    ] {
        let mut builder = Builder::new();
        let o = builder.point(0.0, 0.0, true);
        let q = builder.point(8.0, 0.0, true);
        let p = builder.point(3.0, lift, false);
        distance(&mut builder, 5.0, o, p);
        distance(&mut builder, 5.0, q, p);
        if joined {
            let r = builder.point(13.0, lift, false);
            distance(&mut builder, 10.0, p, r);
            distance(&mut builder, 12.0, p, r);
            builder.equation(Kind::Difference, 20.0, &[p[1], r[1]]);
        }
        let (outcome, values) = builder.outcome();
        assert_eq!((outcome.status, outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels), expected, "lift {lift}, joined {joined}");
        assert!((values[p[0]] - 4.0).abs() < 1e-6 && (values[p[1]].abs() - 3.0).abs() < 1e-6, "{values:?}");
    }
}

#[test]
fn the_most_severe_group_decides_how_a_stalled_sketch_is_diagnosed() {
    // The overlapping dimensions, blamed from their start, beside a triangle too long for its sides,
    // which stays suspected, or beside a repeated dimension near a tangency, whose rank is unclear:
    // the suspicion decides the first and the blame from the start the second, and each group keeps
    // its own labels.
    for suspected in [true, false] {
        let (mut builder, _, _) = overlapping();
        let expected = if suspected {
            let a = builder.point(100.0, 0.0, false);
            let b = builder.point(110.0, 0.0, false);
            let c = builder.point(110.0, 10.0, false);
            distance(&mut builder, 10.0, a, b);
            distance(&mut builder, 10.0, b, c);
            distance(&mut builder, 30.0, a, c);
            (Diagnosis::Suspected, vec![C, C, C, 0, C, C, C])
        } else {
            // p 1.4e-8 mm from where its circle about o touches x = 110, as in the diagnosis tests.
            let o = builder.point(100.0, 0.0, true);
            let p = builder.point(110.0, 1.4e-8, false);
            let q = builder.point(110.0, 5.0, false);
            distance(&mut builder, 10.0, o, p);
            builder.equation(Kind::Value, 110.0, &[p[0]]);
            distance(&mut builder, 5.0, p, q);
            distance(&mut builder, 5.0, p, q);
            (Diagnosis::FromStart, vec![C, C, C, 0, 0, 0, 0, R])
        };
        let (outcome, _) = builder.outcome();
        assert_eq!((outcome.status, outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels), (Status::NotConverged, expected.0, None, expected.1), "suspected {suspected}");
    }
}

#[test]
fn a_triangle_too_long_for_its_sides_is_suspected_whole() {
    // Its nearest point is flat, where the long side is the sum of the other two.
    for equal in [false, true] {
        let mut builder = Builder::new();
        let a = builder.point(0.0, 0.0, false);
        let b = builder.point(10.0, 0.0, false);
        let c = builder.point(10.0, 10.0, false);
        distance(&mut builder, 10.0, a, b);
        distance(&mut builder, 10.0, b, c);
        distance(&mut builder, 30.0, a, c);
        // Equal sides repeat what the two dimensions already say.
        if equal { builder.equation(Kind::EqualLength, 0.0, &[a[0], a[1], b[0], b[1], b[0], b[1], c[0], c[1]]); }
        let expected = if equal { vec![C, C, C, R] } else { vec![C; 3] };
        assert_eq!(diagnose(&builder), (Status::NotConverged, Diagnosis::Suspected, None, expected), "equal {equal}");
    }
}

#[test]
fn a_long_chain_that_cannot_close_is_suspected_within_the_iterations() {
    // Eleven points 10 apart cannot close 150 apart; the chain stalls furthest from its
    // straight nearest point, still within the stalled distance.
    let mut builder = Builder::new();
    let points: Vec<[usize; 2]> = (0..11).map(|i| builder.point(10.0 * (i as f64 * 0.3).cos() * i as f64 / 3.0, 10.0 * (i as f64 * 0.3).sin(), false)).collect();
    for pair in points.windows(2) { distance(&mut builder, 10.0, pair[0], pair[1]); }
    distance(&mut builder, 150.0, points[0], points[10]);
    assert_eq!(diagnose(&builder), (Status::NotConverged, Diagnosis::Suspected, None, vec![C; 11]));
}

#[test]
fn a_near_tangent_pair_beside_a_suspected_conflict_stays_independent() {
    // A corner of a nearly flat triangle held where a circle nearly touches a horizontal: its two
    // rows stay independent by about 1e-4 at the stall. The singular value gate stays at its exact
    // value when the dependence distance loosens, so this pair keeps its rank and only the
    // triangle is blamed.
    let mut builder = Builder::new();
    let o = builder.point(0.0, 0.0, true);
    let a = builder.point(1e-4, 1.0, false);
    let b = builder.point(13.3, 1.2, false);
    let c = builder.point(26.7, 1.0, false);
    distance(&mut builder, 1.0, o, a);
    builder.equation(Kind::Value, 1.0 - 5e-10, &[a[1]]);
    distance(&mut builder, 10.0, a, b);
    distance(&mut builder, 10.0, b, c);
    distance(&mut builder, 30.0, a, c);
    assert_eq!(diagnose(&builder), (Status::NotConverged, Diagnosis::Suspected, None, vec![0, 0, C, C, C]));
}

#[test]
fn a_clear_conflict_is_diagnosed_exactly_and_blamed_alone_beside_a_bystander() {
    // x = 0 and x = 2 conflict; a line through (2, 0) leaning by `lean` per unit up holds the
    // point too, satisfiable with either. Leaning 5e-6, rank is clear and only the dimensions
    // conflict. Leaning 5e-8, it is unclear at the stall, where the looser distance would take in
    // the line, but only the dimensions are the same function, of x, so only they are blamed.
    for (lean, expected) in [(5e-6, (Diagnosis::Diagnosed, vec![C, C, 0])), (5e-8, (Diagnosis::FromStart, vec![C, C, 0]))] {
        let mut builder = Builder::new();
        let p = builder.point(1.0, 0.5, false);
        let a = builder.point(2.0, 0.0, true);
        let b = builder.point(2.0 + lean, 1.0, true);
        builder.equation(Kind::Value, 0.0, &[p[0]]);
        builder.equation(Kind::Value, 2.0, &[p[0]]);
        builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
        assert_eq!(diagnose(&builder), (Status::NotConverged, expected.0, None, expected.1), "lean {lean}");
    }
}

#[test]
fn a_satisfiable_sketch_held_on_a_saddle_is_not_blamed() {
    // p 5 from a and b, 8 apart, starts on their line, and is held there by symmetry, its x tied to
    // q's on a nearly vertical line through (4, 0): the solve stops at (4, 0), where the distances
    // repeat each other with other values as at the start. Yet (4, 3) meets every relation, so they
    // are not blamed, and the stall stays suspected.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(8.0, 0.0, true);
    let p = builder.point(3.0, 0.0, false);
    let q = builder.point(4.0, 0.0, false);
    let c = builder.point(4.0, 0.0, true);
    let d = builder.point(4.00000005, 1.0, true);
    distance(&mut builder, 5.0, a, p);
    distance(&mut builder, 5.0, b, p);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.equation(Kind::PointOnLine, 0.0, &[q[0], q[1], c[0], c[1], d[0], d[1]]);
    assert_eq!(diagnose(&builder), (Status::NotConverged, Diagnosis::Suspected, None, vec![C; 4]));
}
