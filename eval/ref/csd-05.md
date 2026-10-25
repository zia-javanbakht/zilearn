<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 2/6 -->

## Definition of Jacobian Matrix

**Definition 1.2 — Jacobian Matrix (Cook et al. 2002).** For an element with shape functions $N_i(\xi, \eta)$ and nodal coordinates $(x_i, y_i)$, the Jacobian is

$$\mathbf{J} = \frac{\partial(x, y)}{\partial(\xi, \eta)} = \begin{bmatrix} \dfrac{\partial x}{\partial\xi} & \dfrac{\partial y}{\partial\xi} \\[1ex] \dfrac{\partial x}{\partial\eta} & \dfrac{\partial y}{\partial\eta} \end{bmatrix} = \begin{bmatrix} \sum_i \dfrac{\partial N_i}{\partial\xi}\,x_i & \sum_i \dfrac{\partial N_i}{\partial\xi}\,y_i \\[1ex] \sum_i \dfrac{\partial N_i}{\partial\eta}\,x_i & \sum_i \dfrac{\partial N_i}{\partial\eta}\,y_i \end{bmatrix}$$

i.e., a purely local quantity built from shape-function derivatives (known functions of $\xi, \eta$) and the element's own nodal coordinates.

**Keypoint 1.2 — Uniformity of Jacobian.** Distortions of an element, i.e., the deviations from an ideal reference element (equilateral triangle, unit square), is captured by various metrics to characterise the followings within an element:

1. **Jacobian ratio:** the uniformity of Jacobian ($\min/\max > 0.3$ prevents inaccuracies in stres/strain calculations); and
2. **Jacobian determinant:** the determinant of Jacobian ($\det(\mathbf{J}) > 0$ prevents collapsed or inverted elements).

**Example 1.1** Non-uniformity of Jacobian matrix is caused by its dependency on the local coordinates; it happens in the following cases:

1. curved edges,
2. non-parallel sides, or
3. misplaced midside nodes.

A mild variation is ok but drastic changes cause inaccuracies in gradient recovery.

**Application in iso-p formulation**

- **Differentiation:** $N_i$ is defined in $(\xi, \eta)$, but strains need $\partial N_i/\partial x, \partial N_i/\partial y$:

  $$\begin{Bmatrix} \partial N_i/\partial x \\ \partial N_i/\partial y \end{Bmatrix} = \mathbf{J}^{-1} \begin{Bmatrix} \partial N_i/\partial\xi \\ \partial N_i/\partial\eta \end{Bmatrix}$$

  i.e., this is how the strain-displacement matrix $\mathbf{B}$ is assembled. $\mathbf{J}^{-1}$ exists only if $\det(\mathbf{J}) \neq 0$; a valid, non-inverted element further requires $\det(\mathbf{J}) > 0$ at every point.
- **Differential area/volume:**

  $$\mathrm{d}x\,\mathrm{d}y = \det(\mathbf{J})\,\mathrm{d}\xi\,\mathrm{d}\eta$$

  $\det(\mathbf{J})$ is the local area/volume scale factor used when integrating $\mathbf{k}^e, \mathbf{m}^e, \mathbf{f}^e$ over the parent domain.
