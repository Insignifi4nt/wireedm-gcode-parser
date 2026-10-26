mod common;

use common::Builder;
use sketch_solver::diagnose::{CONFLICTING as C, REDUNDANT as R};
use sketch_solver::equations::Kind;
use sketch_solver::problem::{Diagnosis, Status};

/// `(status, diagnosis, degrees of freedom, labels)`
fn diagnose(builder: &Builder) -> (Status, Diagnosis, Option<usize>, Vec<u8>) {
    let (outcome, _) = builder.outcome();
    (outcome.status, outcome.diagnosis, outcome.degrees_of_freedom, outcome.labels)
}

fn distance(builder: &mut Builder, value: f64, p: [usize; 2], q: [usize; 2]) {
    builder.equation(Kind::Distance, value, &[p[0], p[1], q[0], q[1]]);
}

#[test]
fn distances_and_an_offset_that_cannot_agree_are_all_suspected() {
    // 10, 12 and 14 apart and 20 apart vertically: the nearest point stands the pair upright, which
    // the solve approaches only linearly, so rank there is unclear at the exact distance.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    let b = builder.point(10.0, 0.0, false);
    for value in [10.0, 12.0, 14.0] { distance(&mut builder, value, a, b); }
    builder.equation(Kind::Difference, 20.0, &[a[1], b[1]]);
    assert_eq!(diagnose(&builder), (Status::NotConverged, Diagnosis::Suspected, None, vec![C; 4]));
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
fn a_clear_conflict_is_diagnosed_exactly_and_a_stalled_one_can_blame_a_bystander() {
    // x = 0 and x = 2 conflict; a line through (2, 0) leaning by `lean` per unit up holds the
    // point too, satisfiable with either. Leaning 5e-6, rank is clear and only the dimensions
    // conflict. Leaning 5e-8, it is unclear at the stall, and the suspicion takes in the line.
    for (lean, expected) in [(5e-6, (Diagnosis::Diagnosed, vec![C, C, 0])), (5e-8, (Diagnosis::Suspected, vec![C; 3]))] {
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

