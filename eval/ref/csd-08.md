<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 4/6 -->

## Element Quality

[Figure image]

Figure 3. Five metrics for assessing element quality.

**Distortion Types (Hellen & Becker 2017)**

- **Stretch (bad aspect ratio):** unequal edge lengths $\Longrightarrow \mathbf{J}$ badly scaled between $\xi$ and $\eta$
- **Skew:** non-orthogonal edges $\Longrightarrow$ large off-diagonal terms in $\mathbf{J}$
- **Taper:** non-parallel edges $\Longrightarrow \det(\mathbf{J})$ varies strongly over the element $\Longrightarrow$ Gauss-quadrature integral
- **Curvature/warping:** curved or non-planar edges $\longrightarrow \det(\mathbf{J}) \longrightarrow 0$ or changes sign locally
- **Invalid mapping:** $\det(\mathbf{J}) \leq 0$ anywhere $\Longrightarrow$ inverted element, solver aborts

**Non-uniformity consequences**

- **Alteration of Polynomial Degrees:** a non-uniform Jacobian's inverse ($\mathrm{J}^{-1}$) turns clean polynomial displacement derivatives into complex rational functions when mapped to global strains.
- **Numerical Integration Errors:** Gauss quadrature often integrates standard polynomials exactly but cannot exactly integrate the rational functions from a varying Jacobian, injecting numerical error into the stiffness matrix.
- **Artificial Straining and Shear Locking:** highly non-uniform Jacobians struggle to represent simple states (e.g., uniform tension and pure bending), introducing spurious energy modes and artificial 'shear locking'.
- **Unstable Nodal Extrapolation:** extrapolating stresses/strains from Gauss points to nodes becomes unstable under a rapidly changing Jacobian, causing non-physical stress discontinuities between elements.
