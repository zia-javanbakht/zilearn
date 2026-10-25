Next, we recall the expression for the matrix of elastic moduli in the axisymmetric case:

$$\mathbf{C} = \frac{E}{(1+\nu)(1-2\nu)} \begin{bmatrix} (1-\nu) & \nu & 0 & \nu \\ \nu & (1-\nu) & 0 & \nu \\ 0 & 0 & \dfrac{1-2\nu}{2} & 0 \\ \nu & \nu & 0 & (1-\nu) \end{bmatrix} \tag{86}$$

Finally, we compute the strain energy over the element associated with the strain field obtained by adding to (84) the enhanced strain field derived from (81). A lengthy but straightforward calculation shows that the expression for the hoop strain in (81) is precisely such that the factor $(1 - 2\nu)$ disappears from the denominator and the energy remains, therefore, bounded as $\nu \to \frac{1}{2}$. ■

## 5. MODEL PROBLEM II: MINDLIN–REISSNER PLATE BENDING THEORY

To illustrate the generality and wide range of applicability of the methodology introduced in Sections 2, 3 and 4, we consider here its application to the well-known Mindlin–Reissner plate theory.

First we summarize the variational formulation of the problem and mixed finite element interpolation following the same steps as in Section 2. Then, as an illustrative example, we consider the formulation of a new quadrilateral plate bending element with performance similar to the quadrilateral of Hughes and Tezduyar.$^{8}$

### *5.1. Mixed variational formulation*

Let $\mathcal{B} \subset \mathbb{R}^2$ be the domain occupied by a thick plate with thickness $h > 0$. We denote by $\omega(\mathbf{x})$ and $\boldsymbol{\Theta}(\mathbf{x})$ the vertical deflection and two rotations at a point $\mathbf{x} \in \mathcal{B}$. As usual, we set

$$\mathbf{u}^{\mathrm{T}} := [\omega \quad \boldsymbol{\Theta}^{\mathrm{T}}] = [\omega \quad \Theta_1 \quad \Theta_2] \tag{87}$$

The bending and transverse shear strains are

$$\boldsymbol{\kappa} = \nabla^s \boldsymbol{\Theta}, \quad \boldsymbol{\varepsilon} = \nabla \omega - \boldsymbol{\Theta} \tag{88}$$

respectively. A variational formulation of the (linear elastic) plate equations in which (88) is enforced via Lagrange multipliers (corresponding to transverse shear strains) is obtained via the following classical functional:

$$\begin{aligned} \Pi(\mathbf{u}, \boldsymbol{\sigma}, \boldsymbol{\varepsilon}) = &\int_{\mathcal{B}} \tfrac{1}{2} \nabla^s \boldsymbol{\Theta} \cdot \mathbf{C}_b \nabla^s \boldsymbol{\Theta} \, \mathrm{d}V + \Pi_{\mathrm{ext}}(\mathbf{u}) \\ &+ \int_{\mathcal{B}} \left(\tfrac{1}{2} G h k |\boldsymbol{\varepsilon}|^2 + \boldsymbol{\sigma} \cdot [\nabla \omega - \boldsymbol{\Theta} - \boldsymbol{\varepsilon}]\right) \mathrm{d}V \end{aligned} \tag{89}$$

where $\mathbf{C}_b$ is the matrix of bending moduli, and $\Pi_{\mathrm{ext}}(\mathbf{u})$ is the potential energy of the external loading with a standard expression. Note that for simplicity we have assumed isotropy, with $G$ denoting the shear modulus and $k$ the shear coefficient.

<!-- header/footer: 1614 | J. C. SIMO AND M. S. RIFAI -->
