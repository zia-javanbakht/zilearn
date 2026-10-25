<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 3/6 -->

## Isoparameteric vs Generic FE Flow

[Figure image]

a. Generic FE pipeline

[Figure image]

b. Isoparametric FE pipeline

Figure 2. (a) vs. (b): $\mathbf{N}$ picks up an explicit $(\xi, \eta)$ argument and a new $\mathbf{J}$ step is inserted before $\mathbf{B}$. Assembly and solution are identical but in recovery, Jacobian is involved again.

**Keypoint 1.3 — Two Uses of the Jacobian.** $\mathbf{J}$ appears twice: via $\mathbf{J}^{-1}$ to build $\mathbf{B}$ for the strain-displacement relation, and via $\det(\mathbf{J})$ to weight the Gauss-quadrature sum for $\mathbf{k}^e, \mathbf{m}^e, \mathbf{f}^e$, i.e., the same matrix is involved in both differentiation and integration.
