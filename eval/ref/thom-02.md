## 2 Stress Measures

In the reference configuration, the natural stress measure for the strong form is the first Piola–Kirchhoff stress $\mathbf{P}$. For a hyperelastic material with stored-energy density $\Psi(\mathbf{F}, \mathbf{X})$,

$$\mathbf{P} = \frac{\partial\Psi}{\partial\mathbf{F}}.$$

An *objective* hyperelastic law assigns the same stored energy under any superposed rigid motion: $\Psi(\mathbf{Q}\mathbf{F}, \mathbf{X}) = \Psi(\mathbf{F}, \mathbf{X})$ for every proper rotation $\mathbf{Q}$. Since $(\mathbf{Q}\mathbf{F})^T(\mathbf{Q}\mathbf{F}) = \mathbf{F}^T\mathbf{F}$, the energy per unit reference volume can be expressed in terms of the right Cauchy–Green tensor (Appendix A.1)

$$\mathbf{C} = \mathbf{F}^T\mathbf{F}.$$

With this representation,

$$\mathbf{S} = 2\frac{\partial\Psi}{\partial\mathbf{C}}, \qquad \mathbf{P} = \mathbf{F}\mathbf{S},$$

where $\mathbf{S}$ is the second Piola–Kirchhoff stress.

The Cauchy stress $\boldsymbol{\sigma}$ is related to $\mathbf{P}$ by

$$\mathbf{P} = J\boldsymbol{\sigma}\mathbf{F}^{-T}.$$

[Figure image]

Figure 2. Nanson's formula maps oriented surface area. Nominal and Cauchy tractions produce the same force on corresponding surface patches, but their force per unit area generally differs.

## 3 Strong Form in the Reference Configuration

For a *quasi-static* nonlinear elastic solid, loads and deformation may evolve, but inertia is neglected, so equilibrium is enforced at each loading stage. A *static* state is time-independent; both use the same equilibrium equation (Appendix A.2). The strong form is

$$\operatorname{Div}\mathbf{P} + \rho_0\mathbf{b} = \mathbf{0} \quad \text{in } \mathcal{B}_0, \tag{1}$$

$$\boldsymbol{\varphi} = \bar{\boldsymbol{\varphi}} \quad \text{on } \Gamma_\varphi, \tag{2}$$

$$\mathbf{P}\mathbf{N} = \bar{\mathbf{T}} \quad \text{on } \Gamma_T. \tag{3}$$

Here, $\rho_0$ is the mass density per unit reference volume, $\mathbf{b}$ is the body force per unit mass, $\mathbf{N}$ is the outward unit normal in the reference configuration, and $\bar{\mathbf{T}}$ is the prescribed nominal traction per unit reference area.

Thus, the nonlinear boundary value problem is

$$\operatorname{Div}\mathbf{P}(\mathbf{F}, \mathbf{X}) + \rho_0\mathbf{b} = \mathbf{0} \quad \text{in } \mathcal{B}_0, \tag{4}$$

$$\boldsymbol{\varphi} = \bar{\boldsymbol{\varphi}} \quad \text{on } \Gamma_\varphi, \tag{5}$$

$$\mathbf{P}\mathbf{N} = \bar{\mathbf{T}} \quad \text{on } \Gamma_T. \tag{6}$$

<!-- header/footer: NONLINEAR SOLID MECHANICS | Strong forms, weak forms, and consistent tangents | Dr. Lonny L. Thompson, Clemson University, Sept 25, 2026. | 2 / 29 -->
