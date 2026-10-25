Therefore,

$$\Delta\mathbf{P} = \mathbb{A} : \Delta\mathbf{F}.$$

If the external loads are deformation-independent, the consistent tangent is

$$D\mathcal{R}(\boldsymbol{\varphi};\boldsymbol{\eta})[\Delta\mathbf{u}] = \int_{\mathcal{B}_0} \operatorname{Grad}\boldsymbol{\eta} : \mathbb{A} : \operatorname{Grad}\Delta\mathbf{u}\,\mathrm{d}V.$$

The Newton correction solves

$$D\mathcal{R}(\boldsymbol{\varphi}^{(k)};\boldsymbol{\eta})[\Delta\mathbf{u}^{(k)}] = -\mathcal{R}(\boldsymbol{\varphi}^{(k)};\boldsymbol{\eta}) \qquad \forall\boldsymbol{\eta} \in \mathcal{V}_0.$$

In a finite element discretization, this becomes

$$\mathbf{K}_T(\mathbf{d}^{(k)})\Delta\mathbf{d}^{(k)} = -\mathbf{R}(\mathbf{d}^{(k)}).$$

The term *consistent* means that the tangent is obtained by exact linearization of the residual used in the Newton iteration. This yields quadratic convergence near the solution when the other hypotheses for Newton convergence are satisfied.

For the total Lagrangian $\mathbf{S}$–$\mathbf{E}$ formulation, the internal virtual work is

$$\mathcal{G}_{\text{int}}(\mathbf{u};\boldsymbol{\eta}) = \int_{\mathcal{B}_0} \mathbf{S} : \delta\mathbf{E}\,\mathrm{d}V.$$

Its linearization has two contributions:

$$D\mathcal{G}_{\text{int}}[\Delta\mathbf{u}] = \int_{\mathcal{B}_0} \delta\mathbf{E} : \mathbb{C} : \Delta\mathbf{E}\,\mathrm{d}V + \int_{\mathcal{B}_0} \mathbf{S} : \Delta(\delta\mathbf{E})\,\mathrm{d}V,$$

where

$$\mathbb{C} = \frac{\partial\mathbf{S}}{\partial\mathbf{E}}$$

is the material elasticity tensor,

$$\Delta\mathbf{E} = \operatorname{sym}(\mathbf{F}^T\operatorname{Grad}\Delta\mathbf{u}),$$

and

$$\Delta(\delta\mathbf{E}) = \operatorname{sym}\left((\operatorname{Grad}\Delta\mathbf{u})^T\operatorname{Grad}\boldsymbol{\eta}\right).$$

Thus

$$D\mathcal{G}_{\text{int}}[\Delta\mathbf{u}] = \int_{\mathcal{B}_0} \delta\mathbf{E} : \mathbb{C} : \Delta\mathbf{E}\,\mathrm{d}V + \int_{\mathcal{B}_0} \mathbf{S} : \operatorname{sym}\left((\operatorname{Grad}\Delta\mathbf{u})^T\operatorname{Grad}\boldsymbol{\eta}\right)\,\mathrm{d}V.$$

The first term gives the material stiffness; the second gives the geometric or initial-stress stiffness. Both are already contained in $\mathbb{A} = \partial\mathbf{P}/\partial\mathbf{F}$: a separate geometric term must not be added again to the $\mathbf{P}$–$\mathbf{F}$ linearization.

With spatial indices $i, j$ and material indices $I, J, K, L$, the connection is

$$A_{iIjJ} = \delta_{ij}S_{JI} + F_{iK}C_{KIJL}F_{jL}, \qquad (K_{\text{int}})_{Ai,Bj} = \int_{\mathcal{B}_0} N_{A,I}A_{iIjJ}N_{B,J}\,\mathrm{d}V.$$

Repeated indices are summed. For a twice continuously differentiable hyperelastic energy, the internal tangent has major symmetry; it need not be positive definite.

For follower loads, contact tractions, pressure loads acting normal to the deformed surface, or other deformation-dependent loads, the external virtual work must also be linearized. Then

$$\mathbf{K}_T = \mathbf{K}_{\text{int}} - \mathbf{K}_{\text{ext,load}}.$$

This load stiffness is essential for correct convergence and stability in large-deformation problems.

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 9 / 29 -->
