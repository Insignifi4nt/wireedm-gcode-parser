mod common;

use common::Builder;
use sketch_solver::equations::Kind;
use sketch_solver::newton::{DragOutcome, Limits, Outcome};
use sketch_solver::problem::{Diagnosis, Status};
use sketch_solver::solve_buffer;

/// A point held `radius` from a fixed centre, started at `start` and dragged toward `target`.
fn circle(centre: [f64; 2], radius: f64, start: [f64; 2], target: [f64; 2]) -> (Outcome, [f64; 2]) {
    let mut builder = Builder::new();
    let c = builder.point(centre[0], centre[1], true);
    let p = builder.point(start[0], start[1], false);
    builder.equation(Kind::Distance, radius, &[c[0], c[1], p[0], p[1]]);
    builder.temporary(Kind::Value, target[0], &[p[0]]);
    builder.temporary(Kind::Value, target[1], &[p[1]]);
    let (outcome, values) = builder.outcome();
    (outcome, [values[p[0]], values[p[1]]])
}

fn near(a: [f64; 2], b: [f64; 2], tolerance: f64) -> bool { (a[0] - b[0]).hypot(a[1] - b[1]) <= tolerance }

#[test]
fn a_free_point_lands_exactly_on_its_target() {
    let mut builder = Builder::new();
    let p = builder.point(1.0, 2.0, false);
    builder.temporary(Kind::Value, 7.3, &[p[0]]);
    builder.temporary(Kind::Value, -2.1, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[p[0]], values[p[1]]), (7.3, -2.1));
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Reached), 0.0));
    assert_eq!((outcome.diagnosis, outcome.degrees_of_freedom), (Diagnosis::Diagnosed, Some(2)));
}

#[test]
fn a_landed_drag_leaves_the_rest_of_its_group_polished() {
    // Landing writes the target exactly; the point held 30 and 20 mm away follows to roundoff.
    let mut builder = Builder::new();
    let a = builder.point(5.0, 7.0, false);
    let b = builder.point(35.0, 27.0, false);
    builder.equation(Kind::Difference, 30.0, &[a[0], b[0]]);
    builder.equation(Kind::Difference, 20.0, &[a[1], b[1]]);
    builder.temporary(Kind::Value, 10.0, &[a[0]]);
    builder.temporary(Kind::Value, 20.0, &[a[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[a[0]], values[a[1]]), (10.0, 20.0));
    assert!(near([values[b[0]], values[b[1]]], [40.0, 40.0], 1e-13), "{:?}", &values[b[0]..]);
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Reached), 0.0));
}

#[test]
fn a_point_on_a_circle_goes_to_the_nearest_point_to_far_targets() {
    for distance in [15.0, 100.0, 1e6] {
        let direction = [0.3f64.cos(), 0.3f64.sin()];
        let (outcome, p) = circle([0.0, 0.0], 10.0, [10.0, 0.0], [distance * direction[0], distance * direction[1]]);
        assert!(near(p, [10.0 * direction[0], 10.0 * direction[1]], 1e-9), "{distance}: {p:?}");
        assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)), "{distance}");
        assert!((outcome.target_distance - (distance - 10.0)).abs() <= 1e-9 * distance, "{distance}: {}", outcome.target_distance);
        // Targets are never diagnosed: the point keeps its one freedom.
        assert_eq!((outcome.degrees_of_freedom, outcome.labels), (Some(1), vec![0, 0, 0]));
    }
}

#[test]
fn a_dragged_point_leaves_the_far_side_of_its_circle() {
    // Exactly opposite the target the distance is stationary but largest; probes leave it.
    let (outcome, p) = circle([0.0, 0.0], 10.0, [-10.0, 0.0], [20.0, 0.0]);
    assert!(near(p, [10.0, 0.0], 1e-9), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_target_at_the_centre_keeps_the_point_on_its_circle() {
    let (outcome, p) = circle([0.0, 0.0], 10.0, [6.0, 8.0], [0.0, 0.0]);
    assert!((p[0].hypot(p[1]) - 10.0).abs() <= 1e-10, "{p:?}");
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
    assert!((outcome.target_distance - 10.0).abs() <= 1e-10);
}

#[test]
fn circle_drags_do_not_depend_on_position_or_scale() {
    for (offset, scale) in [(1e6, 1.0), (-3e8, 1.0), (0.0, 1e-3), (0.0, 1e3), (5e5, 1e-2)] {
        let at = |x: f64, y: f64| [offset + scale * x, offset + scale * y];
        let (outcome, p) = circle(at(0.0, 0.0), 10.0 * scale, at(10.0, 0.0), at(0.0, 30.0));
        assert!(near(p, at(0.0, 10.0), 1e-9 * scale.max(1.0) + 64.0 * f64::EPSILON * offset.abs()), "{offset} {scale}: {p:?}");
        assert_eq!(outcome.drag, Some(DragOutcome::Projected), "{offset} {scale}");
    }
}

#[test]
fn a_point_on_a_line_goes_to_the_foot_of_its_target() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(1.0, 5.0, true);
    let p = builder.point(0.2, 1.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 7.0, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(near([values[p[0]], values[p[1]]], [12.0 / 26.0, 60.0 / 26.0], 1e-10), "{:?}", &values[p[0]..]);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_far_target_beside_a_linear_relation_projects_in_one_line() {
    // x = 0 holds the point; a target 1e9 away still moves it to y = 1 exactly, and its pull across
    // x = 0 leaves only a residue far below any row's roundoff.
    let mut builder = Builder::new();
    let p = builder.point(0.0, 0.0, false);
    builder.equation(Kind::Value, 0.0, &[p[0]]);
    builder.temporary(Kind::Value, 1e9, &[p[0]]);
    builder.temporary(Kind::Value, 1.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(values[p[0]].abs() <= 1e-30 && values[p[1]] == 1.0, "{:?}", &values[p[0]..]);
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Projected), 1e9));
}

#[test]
fn a_far_target_beside_a_short_guide_still_projects() {
    // A 10 mm guide bounds each step, and a target 1e9 away along the normal must not pin the
    // point to the guide's scale: it reaches the foot of the target.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let b = builder.point(0.0, 10.0, true);
    let p = builder.point(0.0, 2.0, false);
    builder.equation(Kind::PointOnLine, 0.0, &[p[0], p[1], a[0], a[1], b[0], b[1]]);
    builder.temporary(Kind::Value, 1e9, &[p[0]]);
    builder.temporary(Kind::Value, 1000.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert!(near([values[p[0]], values[p[1]]], [0.0, 1000.0], 1e-6), "{:?}", &values[p[0]..]);
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn fixed_and_held_coordinates_count_toward_the_distance_but_stay() {
    // x held by a relation, in its own group from the free y.
    let mut builder = Builder::new();
    let p = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Value, 3.0, &[p[0]]);
    builder.temporary(Kind::Value, 8.0, &[p[0]]);
    builder.temporary(Kind::Value, 4.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[p[0]], values[p[1]]), (3.0, 4.0));
    assert_eq!((outcome.drag, outcome.target_distance), (Some(DragOutcome::Projected), 5.0));
    // An expression-fixed x is never moved; y still is.
    let mut builder = Builder::new();
    let x = builder.parameter(3.0, true);
    let y = builder.parameter(0.0, false);
    builder.temporary(Kind::Value, 8.0, &[x]);
    builder.temporary(Kind::Value, 4.0, &[y]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[x], values[y]), (3.0, 4.0));
    assert_eq!((outcome.status, outcome.drag, outcome.target_distance), (Status::Converged, Some(DragOutcome::Projected), 5.0));
    // With both fixed nothing moves, and a met target is reached.
    for (target, drag, distance) in [([3.0, 0.0], DragOutcome::Reached, 0.0), ([0.0, 4.0], DragOutcome::Projected, 5.0)] {
        let mut builder = Builder::new();
        let p = builder.point(3.0, 0.0, true);
        builder.temporary(Kind::Value, target[0], &[p[0]]);
        builder.temporary(Kind::Value, target[1], &[p[1]]);
        let (outcome, _) = builder.outcome();
        assert_eq!((outcome.diagnosis, outcome.drag, outcome.target_distance), (Diagnosis::NoUnknowns, Some(drag), distance));
    }
}

#[test]
fn groups_without_targets_keep_their_exact_values() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    // Accepted but not at roundoff: a solve without targets would polish it.
    let b = builder.point(3.0 + 1e-12, 4.0, false);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    let p = builder.point(1.0, 1.0, false);
    builder.temporary(Kind::Value, 2.0, &[p[0]]);
    builder.temporary(Kind::Value, 2.0, &[p[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[b[0]], values[b[1]]), (3.0 + 1e-12, 4.0));
    assert_eq!((outcome.drag, outcome.degrees_of_freedom), (Some(DragOutcome::Reached), Some(3)));
}

#[test]
fn an_elbow_keeps_its_side() {
    // Two 10 mm links from a fixed base; the tip is dragged within reach and the elbow stays up.
    let mut builder = Builder::new();
    let base = builder.point(0.0, 0.0, true);
    let joint = builder.point(0.0, 10.0, false);
    let tip = builder.point(10.0, 10.0, false);
    builder.equation(Kind::Distance, 10.0, &[base[0], base[1], joint[0], joint[1]]);
    builder.equation(Kind::Distance, 10.0, &[joint[0], joint[1], tip[0], tip[1]]);
    builder.temporary(Kind::Value, 15.0, &[tip[0]]);
    builder.temporary(Kind::Value, -3.0, &[tip[1]]);
    let (outcome, values) = builder.outcome();
    assert_eq!((values[tip[0]], values[tip[1]]), (15.0, -3.0));
    assert_eq!(outcome.drag, Some(DragOutcome::Reached));
    let side = values[tip[0]] * values[joint[1]] - values[tip[1]] * values[joint[0]];
    assert!(side > 0.0, "the elbow turned over: {:?}", &values[joint[0]..]);
}

/// Two 10 mm links from a fixed base at the origin, joint and tip started at `joint` and `tip`,
/// with the tip dragged toward `target`.
fn arm(joint: [f64; 2], tip: [f64; 2], target: [f64; 2]) -> (Outcome, [f64; 2], [f64; 2]) {
    let mut builder = Builder::new();
    let b = builder.point(0.0, 0.0, true);
    let j = builder.point(joint[0], joint[1], false);
    let t = builder.point(tip[0], tip[1], false);
    builder.equation(Kind::Distance, 10.0, &[b[0], b[1], j[0], j[1]]);
    builder.equation(Kind::Distance, 10.0, &[j[0], j[1], t[0], t[1]]);
    builder.temporary(Kind::Value, target[0], &[t[0]]);
    builder.temporary(Kind::Value, target[1], &[t[1]]);
    let (outcome, values) = builder.outcome();
    (outcome, [values[j[0]], values[j[1]]], [values[t[0]], values[t[1]]])
}

#[test]
fn a_straight_arm_folds_toward_a_target_inside_its_reach() {
    // Straight, the tip cannot move toward the base to first order: only folding the elbow, which
    // keeps the tip still to first order, gets it closer.
    let (outcome, _, tip) = arm([10.0, 0.0], [20.0, 0.0], [15.0, 0.0]);
    assert_eq!(tip, [15.0, 0.0]);
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Reached)));
}

#[test]
fn a_stretched_arm_stays_projected_beyond_its_reach() {
    // Folding takes the tip away from a target beyond its reach, so the straight arm is nearest.
    let (outcome, joint, tip) = arm([10.0, 0.0], [20.0, 0.0], [25.0, 0.0]);
    assert!(near(joint, [10.0, 0.0], 1e-9) && near(tip, [20.0, 0.0], 1e-9), "{joint:?} {tip:?}");
    assert_eq!((outcome.status, outcome.drag), (Status::Converged, Some(DragOutcome::Projected)));
}

#[test]
fn a_tiny_circle_leaves_its_far_side_for_a_target_a_billion_times_further() {
    let (outcome, p) = circle([0.0, 0.0], 0.001, [-0.001, 0.0], [1e9, 0.0]);
    assert!(near(p, [0.001, 0.0], 1e-12), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
}

#[test]
fn a_drag_leaves_a_farthest_point_within_one_iteration_budget() {
    // From the farthest point half way round to the nearest. Stationarity is certified on the
    // gradient, which grows only 0.1 mm per mm along the circle there, so the point is within 1e-8.
    let (outcome, p) = circle([0.0, 0.0], 10.0, [10.0, 0.0], [-1.0, 0.0]);
    assert!(near(p, [-10.0, 0.0], 1e-8), "{p:?}");
    assert_eq!(outcome.drag, Some(DragOutcome::Projected));
    assert!(outcome.iterations <= sketch_solver::newton::DRAG_ITERATIONS / 2, "{}", outcome.iterations);
}

#[test]
fn an_infeasible_start_that_cannot_be_restored_stalls() {
    // Distances 3 and 4 from one fixed point cannot both hold.
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let p = builder.point(3.0, 0.0, false);
    builder.equation(Kind::Distance, 3.0, &[a[0], a[1], p[0], p[1]]);
    builder.equation(Kind::Distance, 4.0, &[a[0], a[1], p[0], p[1]]);
    builder.temporary(Kind::Value, 5.0, &[p[0]]);
    builder.temporary(Kind::Value, 5.0, &[p[1]]);
    let (outcome, _) = builder.outcome();
    assert_eq!((outcome.status, outcome.drag), (Status::NotConverged, Some(DragOutcome::Stalled)));
}

#[test]
fn a_drag_that_runs_out_of_work_is_too_large_and_feasible() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, true);
    let p = builder.point(10.0, 0.0, false);
    builder.equation(Kind::Distance, 10.0, &[a[0], a[1], p[0], p[1]]);
    builder.temporary(Kind::Value, -5.0, &[p[0]]);
    builder.temporary(Kind::Value, 30.0, &[p[1]]);
    let (outcome, values) = builder.outcome_within(Limits { fill: usize::MAX, work: 200 });
    assert_eq!((outcome.status, outcome.drag, outcome.diagnosis), (Status::TooLarge, Some(DragOutcome::Stalled), Diagnosis::Unavailable));
    assert!((values[p[0]].hypot(values[p[1]]) - 10.0).abs() <= 1e-10);
}

#[test]
fn the_same_drag_gives_the_same_bits() {
    let mut builder = Builder::new();
    let base = builder.point(0.0, 0.0, true);
    let joint = builder.point(0.0, 10.0, false);
    let tip = builder.point(10.0, 10.0, false);
    builder.equation(Kind::Distance, 10.0, &[base[0], base[1], joint[0], joint[1]]);
    builder.equation(Kind::Distance, 10.0, &[joint[0], joint[1], tip[0], tip[1]]);
    builder.temporary(Kind::Value, 40.0, &[tip[0]]);
    builder.temporary(Kind::Value, 7.0, &[tip[1]]);
    let (first, second) = (solve_buffer(&builder.encode()), solve_buffer(&builder.encode()));
    assert!(first.len() == second.len() && first.iter().zip(&second).all(|(a, b)| a.to_bits() == b.to_bits()));
    // Out of reach: the arm stretches toward the target.
    assert_eq!(first[7], DragOutcome::Projected as u8 as f64);
}

#[test]
fn only_value_rows_can_be_targets() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    let b = builder.point(1.0, 0.0, false);
    builder.temporary(Kind::Distance, 2.0, &[a[0], a[1], b[0], b[1]]);
    assert_eq!(solve_buffer(&builder.encode())[2], Status::InvalidInput as u8 as f64);
}
