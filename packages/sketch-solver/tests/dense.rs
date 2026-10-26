use sketch_solver::dense::symmetric_eigen;

#[test]
fn jacobi_finds_each_eigenpair_of_a_symmetric_matrix() {
    let a = vec![vec![4.0, 1.0, -2.0, 0.5], vec![1.0, -3.0, 0.0, 2.0], vec![-2.0, 0.0, 1.0, 1.5], vec![0.5, 2.0, 1.5, 0.0]];
    let (values, vectors) = symmetric_eigen(a.clone());
    for (value, vector) in values.iter().zip(&vectors) {
        assert!((vector.iter().map(|x| x * x).sum::<f64>() - 1.0).abs() <= 1e-14);
        for i in 0..4 {
            let av: f64 = (0..4).map(|j| a[i][j] * vector[j]).sum();
            assert!((av - value * vector[i]).abs() <= 1e-13, "{av} {}", value * vector[i]);
        }
    }
    assert!((values.iter().sum::<f64>() - 2.0).abs() <= 1e-13);
}
