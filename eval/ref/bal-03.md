<!-- header/footer: 1 -->

## 1 Overview

The balance laws considered are:

- Conservation of mass
- Conservation of linear momentum
- Conservation of angular momentum
- 1st law of thermodynamics (balance of energy)
- 2nd law of thermodynamics (balance of entropy) — gives a local inequality, used for thermodynamically consistent constitutive material models

**Definition 1.1 — Global and Local Form.** A balance law has a **global (integral)** form and a **local (differential)** form. The global form is stated as an integral over a cut-out part of the body, either a **referential cut** $B_p \subset \mathcal{B}$ or a **spatial cut** $S_p \subset \varphi_t(\mathcal{B})$.

**Definition 1.2 — Referential and Spatial Cuts.** Let $\varphi : \mathcal{B} \to \varphi_t(\mathcal{B})$ be the deformation map taking a material point $\boldsymbol{X}$ in the reference configuration $\mathcal{B}$ to its position $\boldsymbol{x} = \varphi(\boldsymbol{X}, t)$ in the current configuration $\varphi_t(\mathcal{B})$ at time $t$. $B_p$ is the referential (Lagrangian) cut-out part; $S_p = \varphi_t(B_p)$ is its spatial (Eulerian) image, with outward unit normal $\hat{\boldsymbol{n}}$.

[Figure image]

Figure 1: The referential cut-out part $B_p$ and its spatial image, related by the deformation map $\varphi_t(\boldsymbol{X})$.

## 1.1 Transforming a Global Balance Law to Local Form

For the integral form of a balance law stated for the cut-out $B_p$ or $S_p$:

- Apply a Cauchy-type theorem to replace the flux terms in the surface integrals.
- Apply Gauss' theorem to transform surface integrals to volume integrals.
- Apply the localisation theorem.

A **closed system** is one with no mass through the surface and no mass produced/destroyed within the domain.

## 2 The Global-to-Local Tools

**Theorem 2.1 — Cauchy-Type Theorems.** On the boundary of the spatial cut $S_p$, the surface traction $\boldsymbol{t}$ and the outward heat flux depend on the surface orientation only through the outward unit normal $\hat{\boldsymbol{n}}$, and this dependence is linear:

$$\boldsymbol{t}(\hat{\boldsymbol{n}}) = \boldsymbol{\sigma}\cdot\hat{\boldsymbol{n}}, \qquad q(\hat{\boldsymbol{n}}) = \boldsymbol{q}\cdot\hat{\boldsymbol{n}},$$

where $\boldsymbol{\sigma}$ is the spatial stress tensor and $\boldsymbol{q}$ is the spatial heat flux vector.

**Theorem 2.2 — Divergence (Gauss') Theorem.** For a vector field $\boldsymbol{w}$ (or tensor field $\boldsymbol{T}$) on the spatial cut $S_p$
