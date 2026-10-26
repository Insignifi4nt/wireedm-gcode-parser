use sketch_solver::dense::symmetric_eigen;

#[test]
fn jacobi_finds_each_eigenpair_of_a_symmetric_matrix() {
    let a = vec![vec![4.0, 1.0, -2.0, 0.5], vec![1.0, -3.0, 0.0, 2.0], vec![-2.0, 0.0, 1.0, 1.5], vec![0.5, 2.0, 1.5, 0.0]];
    let (values, vectors, _) = symmetric_eigen(a.clone(), usize::MAX).unwrap();
    for (value, vector) in values.iter().zip(&vectors) {
        assert!((vector.iter().map(|x| x * x).sum::<f64>() - 1.0).abs() <= 1e-14);
        for i in 0..4 {
            let av: f64 = (0..4).map(|j| a[i][j] * vector[j]).sum();
            assert!((av - value * vector[i]).abs() <= 1e-13, "{av} {}", value * vector[i]);
        }
    }
    assert!((values.iter().sum::<f64>() - 2.0).abs() <= 1e-13);
}

#[test]
fn small_singular_values_keep_their_absolute_accuracy() {
    // Columns (1, 0, 0), (1, 1e-9, 0) and (0, 0, 3): singular values 3, about sqrt(2) and
    // 1e-9 / sqrt(2), the last far below what the squared Gram matrix resolves.
    let columns = vec![vec![1.0, 0.0, 0.0], vec![1.0, 1e-9, 0.0], vec![0.0, 0.0, 3.0]];
    let (values, vectors, _) = sketch_solver::dense::singular(&columns, usize::MAX).unwrap();
    assert!((values[0] - 3.0).abs() <= 1e-14 && (values[1] - 2f64.sqrt()).abs() <= 1e-14, "{values:?}");
    assert!((values[2] / (1e-9 / 2f64.sqrt()) - 1.0).abs() <= 1e-6, "{values:?}");
    // The smallest right singular vector is (1, -1, 0) / sqrt(2), up to sign.
    let v = &vectors[2];
    assert!((v[0] + v[1]).abs() <= 1e-8 && (v[0].abs() - 0.5f64.sqrt()).abs() <= 1e-8 && v[2].abs() <= 1e-8, "{v:?}");
}
