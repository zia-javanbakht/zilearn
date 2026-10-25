LECTURE NOTES

# Nonlinear Solid Mechanics

Strong forms, weak forms, and consistent tangents

The path from finite-deformation kinematics to nonlinear finite elements rests on a single equilibrium statement. This note derives the reference and spatial forms, identifies work-conjugate strain and stress measures, and linearizes the residual to obtain Newton's tangent for finite element implementation.

### Scope and conventions

A classical continuum is assumed. Unless otherwise stated, the discussion is quasi-static, the material is hyperelastic, and the prescribed reference loads are independent of deformation. Capital-coordinate derivatives and measures refer to the reference body $\mathcal{B}_0$; lowercase ones refer to the current deformed configuration $\mathcal{B}_t$.

## 1 Kinematics and Primary Solution Field

Let the reference body be $\mathcal{B}_0 \subset \mathbb{R}^3$ with boundary partition

$$\partial\mathcal{B}_0 = \Gamma_\varphi \cup \Gamma_T, \qquad \Gamma_\varphi \cap \Gamma_T = \varnothing.$$

The primary unknown is the deformation map, or equivalently the displacement:

$$\boldsymbol{\varphi} : \mathcal{B}_0 \to \mathbb{R}^3, \qquad \mathbf{u}(\mathbf{X}) = \boldsymbol{\varphi}(\mathbf{X}) - \mathbf{X}.$$

Its gradient and local volume ratio are

$$\mathbf{F} = \operatorname{Grad}\boldsymbol{\varphi} = \mathbf{I} + \operatorname{Grad}\mathbf{u}, \qquad J = \det\mathbf{F} > 0.$$

For a sufficiently smooth deformation, $J > 0$ ensures local orientation preservation and local invertibility.

[Figure image]

Figure 1. The deformation map moves material points, and its gradient maps local line elements. The illustrated affine deformation stretches and shears the body.

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 1 / 29 -->
