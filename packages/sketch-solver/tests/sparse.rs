use sketch_solver::sparse::{Factor, SparseRow, minimum_degree};

/// `(J^T J + mu I) h = J^T b` by Gaussian elimination, the reference for a damped step.
fn normal_equations(rows: &[(SparseRow, f64)], n: usize, mu: f64) -> Vec<f64> {
    let mut a = vec![vec![0.0; n + 1]; n];
    for (row, b) in rows {
        for &(i, x) in row {
            for &(j, y) in row { a[i][j] += x * y; }
            a[i][n] += x * b;
        }
    }
    for (k, row) in a.iter_mut().enumerate() { row[k] += mu; }
    for k in 0..n {
        for i in k + 1..n {
            let f = a[i][k] / a[k][k];
            for j in k..=n { a[i][j] -= f * a[k][j]; }
        }
    }
    let mut h = vec![0.0; n];
    for k in (0..n).rev() { h[k] = (a[k][n] - (k + 1..n).map(|j| a[k][j] * h[j]).sum::<f64>()) / a[k][k]; }
    h
}

fn factor(rows: &[(SparseRow, f64)], n: usize, mu: f64) -> Factor {
    let mut factor = Factor::damped(n, mu);
    for (row, b) in rows { factor.rotate(row.clone(), *b); }
    factor
}

#[test]
fn the_sparse_factor_solves_damped_least_squares() {
    let rows: Vec<(SparseRow, f64)> = vec![
        (vec![(0, 2.0), (2, -1.0)], 1.0),
        (vec![(1, 0.5), (3, 3.0)], -2.0),
        (vec![(0, 1.0), (1, 1.0), (2, 1.0)], 0.25),
        (vec![(2, 4.0), (3, -0.5)], 3.0),
        (vec![(1, -2.0)], 0.5),
    ];
    for mu in [1e-6, 0.3, 10.0] {
        let h = factor(&rows, 4, mu).solve().unwrap();
        let expected = normal_equations(&rows, 4, mu);
        assert!(h.iter().zip(&expected).all(|(a, b)| (a - b).abs() < 1e-12), "{h:?} {expected:?}");
    }
}

#[test]
fn an_undamped_factor_without_a_pivot_has_no_step() {
    let rows: Vec<(SparseRow, f64)> = vec![(vec![(0, 1.0), (1, 1.0)], 1.0)];
    assert!(factor(&rows, 2, 0.0).solve().is_none());
    assert_eq!(factor(&rows, 2, 1.0).solve().map(|h| h.len()), Some(2));
}

#[test]
fn a_scrambled_chain_is_ordered_to_a_band_and_its_fill_bounds_the_factor() {
    // Columns of a chain of 200 links, numbered out of order, so authoring order would fill.
    let n = 200;
    let label = |k: usize| (k * 73) % n;
    let structure: Vec<Vec<usize>> = (1..n).map(|k| vec![label(k - 1), label(k)]).collect();
    let (position, fill) = minimum_degree(n, structure.iter());
    assert!(fill <= 2 * n, "{fill}");
    let mut sorted = position.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, (0..n).collect::<Vec<_>>());
    let rows: Vec<(SparseRow, f64)> = structure.iter().enumerate().map(|(i, columns)| {
        let mut row: SparseRow = columns.iter().map(|&c| (position[c], 1.0 + (i % 3) as f64)).collect();
        row.sort_unstable_by_key(|entry| entry.0);
        (row, 1.0)
    }).collect();
    let factor = factor(&rows, n, 0.5);
    assert!(factor.rows.iter().map(|row| row.len()).sum::<usize>() <= fill);
}
