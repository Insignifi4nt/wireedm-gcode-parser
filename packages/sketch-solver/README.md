# Sketch solver

Wire EDM's own 2D sketch constraint solver: a Rust crate with no dependencies, compiled to `wasm/sketch_solver.wasm`. The app does not load it yet; PlaneGCS still solves sketches. See "Native sketch solver" in `docs/maintainers/cad-performance.md` for its status.

- `src/equations.rs` holds the twelve scalar equation kinds. Their gradients come from the dual numbers in `src/dual.rs`.
- `src/newton.rs` solves each connected group of unknowns with damped Gauss-Newton and accepts the result against the sketch driver tolerance in millimetres.
- `src/problem.rs` defines the `f64` wire format. `src/lib.rs` exports `buffer_alloc`, `buffer_free` and `solve`.
- The TypeScript side is in `src/features/cad/sketch-solver/native/`:
  - the equation model and its encoder;
  - the compiler from sketch graphs;
  - the loader.

`npm run solver:build` rebuilds the module and `wasm/manifest.json` with the toolchain pinned in `rust-toolchain.toml`; commit both. `npm run solver:check` runs `cargo test` and fails unless a fresh build matches the committed module byte for byte. CI runs it in the native solver job. Source paths are remapped so Windows and Linux builds match.
