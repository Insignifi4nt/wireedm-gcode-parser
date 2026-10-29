mod common;

use common::Builder;
use sketch_solver::diagnose::{DETERMINED, FREE, NOT_ANALYSED, Row, TAU, diagnose_defining};
use sketch_solver::equations::Kind;
use sketch_solver::problem::{DEFINE, Diagnosis, Status, VERSION};
use sketch_solver::solve_buffer;

const D: u8 = DETERMINED;
const F: u8 = FREE;
const U: u8 = NOT_ANALYSED;

/// Each parameter's definition, checked to leave the solve as it was and, where the sketch
/// converged and was diagnosed exactly, to find every parameter determined just when no freedom
/// is left.
fn definition(builder: &Builder) -> Vec<u8> {
    let (n, m) = (builder.values.len(), builder.equations());
    let (plain, defining) = (solve_buffer(&builder.encode()), solve_buffer(&builder.encode_with(DEFINE)));
    assert_eq!(defining.len(), 9 + n + m + n);
    let bits = |output: &[f64]| output[..9 + n + m].iter().map(|value| value.to_bits()).collect::<Vec<_>>();
    assert_eq!(bits(&plain), bits(&defining), "asking for definition changes nothing else");
    let codes: Vec<u8> = defining[9 + n + m..].iter().map(|&code| code as u8).collect();
    assert!(codes.iter().all(|&code| code <= DETERMINED));
    for (p, &fixed) in builder.fixed.iter().enumerate() { if fixed { assert_eq!(codes[p], D, "fixed parameter {p}"); } }
    let (outcome, _) = builder.outcome_defining();
    assert_eq!(outcome.definition, codes);
    if outcome.status == Status::Converged && outcome.diagnosis == Diagnosis::Diagnosed && let Some(freedom) = outcome.degrees_of_freedom {
        assert_eq!(freedom == 0, codes.iter().all(|&code| code == D), "all determined just when no freedom is left");
    }
    codes
}

/// A rectangle from `(x, y)`, 4 wide and 3 high but drawn askew, with its sides held level and
/// upright: corners bottom left, bottom right, top right, top left.
fn rectangle(builder: &mut Builder, x: f64, y: f64) -> [[usize; 2]; 4] {
    let corners = [builder.point(x + 0.1, y - 0.2, false), builder.point(x + 4.3, y + 0.1, false),
        builder.point(x + 3.8, y + 3.2, false), builder.point(x - 0.2, y + 2.9, false)];
    let [a, b, c, d] = corners;
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    builder.equation(Kind::Difference, 0.0, &[d[1], c[1]]);
    builder.equation(Kind::Difference, 0.0, &[a[0], d[0]]);
    builder.equation(Kind::Difference, 0.0, &[b[0], c[0]]);
    corners
}

fn fix(builder: &mut Builder, point: [usize; 2], x: f64, y: f64) {
    builder.equation(Kind::Value, x, &[point[0]]);
    builder.equation(Kind::Value, y, &[point[1]]);
}

#[test]
fn parameters_no_equation_reads_are_free_and_fixed_ones_determined() {
    let mut builder = Builder::new();
    builder.point(1.0, 2.0, false);
    builder.point(3.0, 4.0, true);
    builder.parameter(5.0, false);
    assert_eq!(definition(&builder), vec![F, F, D, D, F]);
}

#[test]
fn a_full_rank_group_is_all_determined() {
    let mut builder = Builder::new();
    let a = builder.point(0.1, -0.2, false);
    let b = builder.point(4.0, 1.0, false);
    fix(&mut builder, a, 0.0, 0.0);
    builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
    builder.equation(Kind::Distance, 5.0, &[a[0], a[1], b[0], b[1]]);
    assert_eq!(definition(&builder), vec![D; 4]);
}

#[test]
fn a_rectangle_held_only_level_and_upright_is_free_everywhere() {
    for (x, y) in [(0.0, 0.0), (1e5, 1e5)] {
        let mut builder = Builder::new();
        rectangle(&mut builder, x, y);
        assert_eq!(definition(&builder), vec![F; 8], "at ({x}, {y})");
    }
    // Already level and upright, so solved whole from where it is.
    let mut builder = Builder::new();
    for (x, y) in [(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)] { builder.point(x, y, false); }
    builder.equation(Kind::Difference, 0.0, &[1, 3]);
    builder.equation(Kind::Difference, 0.0, &[7, 5]);
    builder.equation(Kind::Difference, 0.0, &[0, 6]);
    builder.equation(Kind::Difference, 0.0, &[2, 4]);
    assert_eq!(definition(&builder), vec![F; 8]);
}

#[test]
fn a_fixed_corner_and_a_width_define_the_bottom_corners_alone_wherever_the_rectangle_is() {
    // The width as a horizontal dimension, which is eliminated, and as a distance, solved whole;
    // the corner fixed by values and by fixed parameters.
    let expected = vec![D, D, D, D, D, F, D, F];
    for (x, y) in [(0.0, 0.0), (1e5, 1e5), (-1e5, 3e4)] {
        for (distance, by_value) in [(false, true), (true, true), (false, false), (true, false)] {
            let mut builder = Builder::new();
            let [a, b, ..] = if by_value {
                let corners = rectangle(&mut builder, x, y);
                fix(&mut builder, corners[0], x, y);
                corners
            } else {
                let a = builder.point(x, y, true);
                let corners = [a, builder.point(x + 4.3, y + 0.1, false), builder.point(x + 3.8, y + 3.2, false), builder.point(x - 0.2, y + 2.9, false)];
                let [a, b, c, d] = corners;
                builder.equation(Kind::Difference, 0.0, &[a[1], b[1]]);
                builder.equation(Kind::Difference, 0.0, &[d[1], c[1]]);
                builder.equation(Kind::Difference, 0.0, &[a[0], d[0]]);
                builder.equation(Kind::Difference, 0.0, &[b[0], c[0]]);
                corners
            };
            if distance { builder.equation(Kind::Distance, 4.0, &[a[0], a[1], b[0], b[1]]); } else { builder.equation(Kind::Difference, 4.0, &[a[0], b[0]]); }
            assert_eq!(definition(&builder), expected, "at ({x}, {y}), distance {distance}, by value {by_value}");
        }
    }
}

#[test]
fn a_fixed_corner_a_width_and_a_height_define_every_corner() {
    for (x, y) in [(0.0, 0.0), (1e5, 1e5)] {
        let mut builder = Builder::new();
        let [a, b, _, d] = rectangle(&mut builder, x, y);
        fix(&mut builder, a, x, y);
        builder.equation(Kind::Difference, 4.0, &[a[0], b[0]]);
        builder.equation(Kind::Distance, 3.0, &[a[0], a[1], d[0], d[1]]);
        assert_eq!(definition(&builder), vec![D; 8], "at ({x}, {y})");
    }
}

#[test]
fn a_circle_needs_its_centre_and_its_radius() {
    // A fixed centre leaves the radius free, and a fixed radius the centre.
    let mut builder = Builder::new();
    let centre = builder.point(1.0, 2.0, false);
    builder.parameter(3.0, false);
    fix(&mut builder, centre, 1.0, 2.0);
    assert_eq!(definition(&builder), vec![D, D, F]);
    let mut builder = Builder::new();
    builder.point(1.0, 2.0, false);
    let radius = builder.parameter(3.0, false);
    builder.equation(Kind::Value, 3.0, &[radius]);
    assert_eq!(definition(&builder), vec![F, F, D]);
    // A fixed point on it from a fixed centre defines the radius.
    let mut builder = Builder::new();
    let (centre, point) = (builder.point(1.0, 2.0, false), builder.point(4.0, 6.0, false));
    let radius = builder.parameter(4.0, false);
    fix(&mut builder, centre, 1.0, 2.0);
    fix(&mut builder, point, 4.0, 6.0);
    builder.equation(Kind::DistanceToParameter, 0.0, &[centre[0], centre[1], point[0], point[1], radius]);
    assert_eq!(definition(&builder), vec![D, D, D, D, D]);
}

#[test]
fn an_arc_with_a_fixed_centre_and_radius_leaves_its_ends_free() {
    let mut builder = Builder::new();
    let at = |degrees: f64| (5.0 * degrees.to_radians().cos(), 5.0 * degrees.to_radians().sin());
    let ((sx, sy), (ex, ey)) = (at(30.0), at(125.0));
    let (centre, start, end) = (builder.point(0.0, 0.0, false), builder.point(sx, sy, false), builder.point(ex, ey, false));
    builder.equation(Kind::EqualLength, 0.0, &[centre[0], centre[1], start[0], start[1], centre[0], centre[1], end[0], end[1]]);
    fix(&mut builder, centre, 0.0, 0.0);
    builder.equation(Kind::Distance, 5.0, &[centre[0], centre[1], start[0], start[1]]);
    assert_eq!(definition(&builder), vec![D, D, F, F, F, F]);
}

#[test]
fn coordinates_held_only_in_sum_are_both_free() {
    // `(x + y) / 2 = 0` against a fixed middle.
    let mut builder = Builder::new();
    let (x, y, middle) = (builder.parameter(1.0, false), builder.parameter(-0.5, false), builder.parameter(0.0, true));
    builder.equation(Kind::Midpoint, 0.0, &[x, y, middle]);
    assert_eq!(definition(&builder), vec![F, F, D]);
}

#[test]
fn a_group_whose_constraint_conflicts_elsewhere_is_not_analysed() {
    // One constraint holds `q` on `p` on both axes. Its y equation conflicts with another, so its x
    // equation conflicts too, and the group of x, though converged and fully defined, is not
    // analysed; nor is the group of y, which did not converge.
    let mut builder = Builder::new();
    let (p, q) = (builder.point(0.0, 0.0, false), builder.point(1.0, 1.0, false));
    builder.point(2.0, 2.0, false);
    builder.equation(Kind::Difference, 0.0, &[p[0], q[0]]);
    builder.same(Kind::Difference, 0.0, &[p[1], q[1]]);
    builder.equation(Kind::Difference, 5.0, &[p[1], q[1]]);
    builder.equation(Kind::Value, 0.0, &[p[0]]);
    let (outcome, _) = builder.outcome_defining();
    assert_eq!(outcome.status, Status::NotConverged);
    assert_eq!(definition(&builder), vec![U, U, U, U, F, F]);
}

#[test]
fn a_drag_cannot_ask_for_definition_and_unknown_options_or_versions_are_refused() {
    let mut builder = Builder::new();
    let a = builder.point(0.0, 0.0, false);
    builder.equation(Kind::Value, 1.0, &[a[0]]);
    let invalid = |buffer: &[f64]| solve_buffer(buffer)[2] == Status::InvalidInput as u8 as f64;
    assert!(!invalid(&builder.encode_with(DEFINE)));
    for options in [2, 3, 4] { assert!(invalid(&builder.encode_with(options)), "options {options}"); }
    let mut previous = builder.encode_with(DEFINE);
    previous[0] = VERSION - 1.0;
    assert!(invalid(&previous));
    builder.temporary(Kind::Value, 2.0, &[a[1]]);
    assert!(!invalid(&builder.encode()));
    assert!(invalid(&builder.encode_with(DEFINE)));
    // Invalid input has no values, labels or definition.
    assert_eq!(solve_buffer(&builder.encode_with(DEFINE)).len(), 9);
}

/// One row over two columns, its entries `(1, small)`, or `(small, 1)` when `swapped`.
fn tilted(small: f64, swapped: bool, allowance: usize) -> (Option<Vec<u8>>, usize) {
    let norm = (1.0 + small * small).sqrt();
    let entries = if swapped { vec![(0, small / norm), (1, 1.0 / norm)] } else { vec![(0, 1.0 / norm), (1, small / norm)] };
    let mut left = allowance;
    let (diagnosis, _) = diagnose_defining(2, &[Row { entries, residual: 0.0, tolerance: 1e-10 }], TAU, usize::MAX, usize::MAX, Some(&mut left));
    let diagnosis = diagnosis.unwrap();
    assert!(diagnosis.certain);
    (diagnosis.definition, allowance - left)
}

#[test]
fn a_column_moved_too_little_to_tell_is_not_analysed() {
    // The free direction is `(-small, 1)` up to its norm: the second column is free, and the first
    // moves by about `small`, determined within `TAU`, free above `1e3 TAU` and unknown between.
    let analysed = |small, swapped| tilted(small, swapped, usize::MAX).0.unwrap();
    assert_eq!(analysed(1e-12, false), vec![D, F]);
    assert_eq!(analysed(1e-9, false), vec![U, F]);
    assert_eq!(analysed(1e-3, false), vec![F, F]);
    // With the small entry leading, the first column takes the pivot and the second is left. Its
    // unit row reaches that column with a lead of one, but the direction moves it by only about
    // `small` of its length, so it is unknown; the first is free whatever its pivot.
    assert_eq!(analysed(1e-9, true), vec![F, U]);
    assert_eq!(analysed(1e-3, true), vec![F, F]);
}

#[test]
fn a_column_one_free_direction_barely_moves_is_free_by_the_next() {
    // One row over three columns, its entries `(1, small, 1)`: the free direction of the second
    // column moves the first by only about `small`, too little to tell, but the third moves it
    // by about half its length.
    let small: f64 = 1e-9;
    let norm = (2.0 + small * small).sqrt();
    let entries = vec![(0, 1.0 / norm), (1, small / norm), (2, 1.0 / norm)];
    let mut left = usize::MAX;
    let (diagnosis, _) = diagnose_defining(3, &[Row { entries, residual: 0.0, tolerance: 1e-10 }], TAU, usize::MAX, usize::MAX, Some(&mut left));
    assert_eq!(diagnosis.unwrap().definition, Some(vec![F, F, F]));
}

/// Points `P` free, `Q` on a fixed x and `R` on a fixed y, with `P` and `Q` level and each a
/// distance from a fixed point: `P` 1 from `A` at `(0, -1)` and `R` about 1 from `Q`. `P` sits
/// `5e-11` right of `A`, and `R` `1e-5` right of `Q`.
fn leaning() -> Builder {
    let mut builder = Builder::new();
    let p = builder.point(5e-11, 0.0, false);
    let q = [builder.parameter(0.0, true), builder.parameter(0.0, false)];
    let r = [builder.parameter(1e-5, false), builder.parameter(-1.0, true)];
    let a = builder.point(0.0, -1.0, true);
    builder.equation(Kind::Distance, 1.0, &[p[0], p[1], a[0], a[1]]);
    builder.equation(Kind::Distance, 1.00000000005, &[q[0], q[1], r[0], r[1]]);
    builder.equation(Kind::Difference, 0.0, &[p[1], q[1]]);
    builder
}

#[test]
fn leads_the_factor_dropped_are_allowed_for_before_a_column_is_determined() {
    // Over `P.x`, `P.y`, `Q.y` and `R.x`, the free direction is about `(1, -5e-11, -5e-11, 5e-6)`:
    // `R.x` moves by more than `1e3 TAU`. The first row's lead in `P.x` is within `TAU`, so the
    // factor drops it and leaves `P.x` out of every row, and through the factor alone `R.x` and the
    // others look determined. Allowing for the lead dropped, `P.x` is still free and the others are
    // unknown: the allowance hides whether `R.x` moves, and also that `P.y` and `Q.y` barely do.
    let unit = |entries: Vec<(usize, f64)>| {
        let norm = entries.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt();
        Row { entries: entries.into_iter().map(|(k, x)| (k, x / norm)).collect(), residual: 0.0, tolerance: 1e-10 }
    };
    let rows = [unit(vec![(0, 5e-11), (1, 1.0)]), unit(vec![(2, 1.0), (3, 1e-5)]), unit(vec![(1, -1.0), (2, 1.0)])];
    let mut left = usize::MAX;
    let diagnosis = diagnose_defining(4, &rows, TAU, usize::MAX, usize::MAX, Some(&mut left)).0.unwrap();
    assert!(diagnosis.certain);
    assert_eq!(diagnosis.rank, 3);
    assert_eq!(diagnosis.definition, Some(vec![F, U, U, U]));
    // Through the wire, over `P`, `Q`, `R` and `A`.
    assert_eq!(definition(&leaning()), vec![F, U, D, U, U, D, D, D]);
}

/// The most a unit direction that `rows` leave free moves column `j`: the distance of its unit row
/// from their span, by Gram-Schmidt twice over.
fn reach(rows: &[Vec<f64>], j: usize) -> f64 {
    let n = rows[0].len();
    let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let mut basis: Vec<Vec<f64>> = Vec::new();
    let orthogonalize = |basis: &[Vec<f64>], v: &mut Vec<f64>| for _ in 0..2 {
        for q in basis { let d = dot(q, v); for k in 0..n { v[k] -= d * q[k]; } }
    };
    for row in rows {
        let mut v = row.clone();
        orthogonalize(&basis, &mut v);
        let norm = dot(&v, &v).sqrt();
        basis.push(v.into_iter().map(|x| x / norm).collect());
    }
    let mut e = vec![0.0; n];
    e[j] = 1.0;
    orthogonalize(&basis, &mut e);
    dot(&e, &e).sqrt()
}

#[test]
fn random_rows_with_entries_near_tau_are_classified_by_how_their_free_directions_move_each_column() {
    // Unit rows over two to six columns, of independent rank, with entries of very different
    // sizes, many within `TAU`, so the factor drops leads. A seeded generator keeps the cases the
    // same on every run. Each analysed code is checked against the rows' own free directions,
    // allowing for the rounding of the reference.
    let mut seed = 0x5eed_u64;
    let mut next = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 11) as f64 / (1u64 << 53) as f64
    };
    let sizes = [0.0, 0.0, 1.0, 1e-3, 1e-5, 1e-7, 3e-11, 9e-11, 2e-10, 1e-12];
    let (mut free, mut determined) = (0, 0);
    for _ in 0..20_000 {
        let n = 2 + (next() * 5.0) as usize;
        let m = 1 + (next() * (n - 1) as f64) as usize;
        let dense: Vec<Vec<f64>> = (0..m).map(|_| {
            let mut row: Vec<f64> = (0..n).map(|_| sizes[(next() * 10.0) as usize] * (2.0 * next() - 1.0)).collect();
            if row.iter().all(|&x| x == 0.0) { row[(next() * n as f64) as usize] = 1.0; }
            let norm = row.iter().map(|x| x * x).sum::<f64>().sqrt();
            row.into_iter().map(|x| x / norm).collect()
        }).collect();
        let rows: Vec<Row> = dense.iter().map(|row| Row {
            entries: row.iter().copied().enumerate().filter(|e| e.1 != 0.0).collect(), residual: 0.0, tolerance: 1e-10 }).collect();
        let mut left = usize::MAX;
        let diagnosis = diagnose_defining(n, &rows, TAU, usize::MAX, usize::MAX, Some(&mut left)).0.unwrap();
        // Rows within `TAU` of the span of earlier ones are left to the convention of rank.
        if !diagnosis.certain || diagnosis.rank < m { continue; }
        for (j, &code) in diagnosis.definition.unwrap().iter().enumerate() {
            let moved = reach(&dense, j);
            if code == D { determined += 1; assert!(moved <= 2.0 * TAU, "determined, moved {moved:e} by rows {dense:?}"); }
            if code == F { free += 1; assert!(moved > 0.5e3 * TAU, "free, moved {moved:e} by rows {dense:?}"); }
        }
    }
    assert!(determined > 1000 && free > 10_000, "determined {determined}, free {free}");
}

#[test]
fn definition_takes_only_its_own_allowance() {
    let (codes, spent) = tilted(1e-3, false, usize::MAX);
    assert_eq!(codes.unwrap(), vec![F, F]);
    assert!(spent > 0);
    // Out of allowance nothing is analysed, and the diagnosis is the same.
    assert_eq!(tilted(1e-3, false, 0).0.unwrap(), vec![U, U]);
    assert_eq!(tilted(1e-3, false, spent - 1).0.unwrap().last(), Some(&U));
    // A full-rank group needs no probe.
    let mut left = 0;
    let rows = [Row { entries: vec![(0, 1.0)], residual: 0.0, tolerance: 1e-10 }, Row { entries: vec![(1, 1.0)], residual: 0.0, tolerance: 1e-10 }];
    assert_eq!(diagnose_defining(2, &rows, TAU, usize::MAX, usize::MAX, Some(&mut left)).0.unwrap().definition, Some(vec![D, D]));
    // Definition is asked for at `TAU` only, and only where rank is certain.
    let mut left = usize::MAX;
    assert_eq!(diagnose_defining(2, &rows, 1e-6, usize::MAX, usize::MAX, Some(&mut left)).0.unwrap().definition, None);
    assert_eq!(diagnose_defining(2, &rows, TAU, usize::MAX, usize::MAX, None).0.unwrap().definition, None);
}

#[test]
fn each_group_is_all_determined_just_when_its_rank_is_full() {
    // Rows over three columns, each of rank one to three.
    let row = |entries: Vec<(usize, f64)>| {
        let norm = entries.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt();
        Row { entries: entries.into_iter().map(|(k, x)| (k, x / norm)).collect(), residual: 0.0, tolerance: 1e-10 }
    };
    let cases = [vec![row(vec![(0, 1.0), (2, 1.0)])], vec![row(vec![(0, 1.0), (1, -2.0)]), row(vec![(1, 1.0), (2, 3.0)])],
        vec![row(vec![(0, 1.0), (1, 1.0)]), row(vec![(1, 1.0), (2, 1.0)]), row(vec![(0, 1.0), (2, -1.0)])],
        vec![row(vec![(0, 1.0)]), row(vec![(1, 2.0), (2, 1.0)]), row(vec![(2, 1.0)])]];
    for rows in cases {
        let mut left = usize::MAX;
        let diagnosis = diagnose_defining(3, &rows, TAU, usize::MAX, usize::MAX, Some(&mut left)).0.unwrap();
        let codes = diagnosis.definition.unwrap();
        assert_eq!(diagnosis.rank == 3, codes.iter().all(|&code| code == D), "rank {} codes {codes:?}", diagnosis.rank);
        assert!(codes.iter().all(|&code| code != U));
    }
}
