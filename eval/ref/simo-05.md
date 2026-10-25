*Remarks 2.1.*

1. Note that the local Euler–Lagrange equations associated with (9) are the standard equilibrium equations in $\mathcal{B}$; namely,

$$\left.\begin{aligned} &\operatorname{div}[\partial_{\varepsilon} W(\mathbf{x}, \nabla^{s}\mathbf{u} + \tilde{\boldsymbol{\varepsilon}})] + \rho_0 \mathbf{b} = \mathbf{0} \\ &\tilde{\boldsymbol{\varepsilon}} = \mathbf{0} \\ &\boldsymbol{\sigma} = \partial_{\varepsilon} W(\mathbf{x}, \nabla^{s}\mathbf{u} + \tilde{\boldsymbol{\varepsilon}}) \end{aligned}\right\} \tag{10}$$

along with the stress boundary condition (2) on $\partial_{\sigma}\mathcal{B}$. Although $\tilde{\boldsymbol{\varepsilon}} = \mathbf{0}$ in $\mathcal{B}$ for the continuum problem, in general $\tilde{\boldsymbol{\varepsilon}}^{h} \neq \mathbf{0}$, when we introduce finite element approximations.

2. Equations (9)–(10) are the Euler equations of the functional

$$\Pi(\mathbf{u}, \tilde{\boldsymbol{\varepsilon}}, \boldsymbol{\sigma}) := \int_{\mathcal{B}} [W(\mathbf{x}, \nabla^{s}\mathbf{u} + \tilde{\boldsymbol{\varepsilon}}) - \boldsymbol{\sigma}\cdot\tilde{\boldsymbol{\varepsilon}}]\, \mathrm{d}V - \int_{\mathcal{B}} \rho_0 \mathbf{b}\cdot\mathbf{u}\, \mathrm{d}V - \int_{\partial_{\sigma}\mathcal{B}} \bar{\mathbf{t}}\cdot\mathbf{u}\, \mathrm{d}\Gamma \tag{11}$$

as a straightforward manipulation shows.

3. Observe that the space of *enhanced* strain fields is in $[L_2(\mathcal{B})]^{n_{\mathrm{sym}}}$. Hence, *no interelement continuity on $\tilde{\boldsymbol{\varepsilon}}$ need be enforced when constructing finite element approximations.* $\blacksquare$

### 2.2. *Mixed finite element approximations*

Let $\mathcal{B} = \bigcup_{e=1}^{n_{\mathrm{elm}}} \mathcal{B}_e$ be a finite element approximation constructed by means of standard *isoparametric* elements. Denoting by $\square = [-1, 1] \times \overset{n_{\mathrm{dim}}}{\cdots} \times [-1, 1]$ the unit cube in isoparametric space, we thus have, for a typical element $\mathcal{B}_e$,

$$\boldsymbol{\xi} \in \square \mapsto \mathbf{x}_e = \sum_{A=1}^{n_{\mathrm{nodes}}^{e}} N^{A}(\boldsymbol{\xi})\mathbf{x}_A \in \mathcal{B}_e \tag{12}$$

where $N^{A}(\boldsymbol{\xi})$ $(A = 1, \ldots, n_{\mathrm{nodes}}^{e})$ are the standard isoparametric shape functions satisfying

$$N^{A}(\boldsymbol{\xi}_B) = \delta_B^A \tag{13}$$

and $\boldsymbol{\xi}_B$ $(B = 1, \ldots, n_{\mathrm{nodes}}^{e})$ denote the vertices of $\square$. Using *vector notation* and standard conventions in finite element analysis (see e.g. Zienkiewicz and Taylor$^{27}$) we write

$$\mathbf{u}_e^h = \mathbf{N}_e(\boldsymbol{\xi})\mathbf{d}_e, \quad \nabla^{s}\mathbf{u}_e^h = \mathbf{B}_e(\boldsymbol{\xi})\mathbf{d}_e \tag{14}$$

where $\mathbf{d}_e \in \mathbb{R}^{n_{\mathrm{dim}} \times n_{\mathrm{nodes}}^{e}}$ is the vector of element nodal displacements, and $\mathbf{B}_e(\boldsymbol{\xi})$ is the *discrete strain operator.*

#### 2.2.1. *The enhanced strain field interpolation.*

We consider the following *discontinuous finite* element approximation for the space $\tilde{\mathcal{E}}$ of enhanced strain fields. Let $\chi_e : \mathcal{B}_e \to \mathbb{R}$ be the characteristic function of $\mathcal{B}_e$ defined as

$$\chi_e = \begin{cases} 1 & \text{iff } \mathbf{x} \in \mathcal{B}_e \\ 0 & \text{otherwise} \end{cases} \tag{15}$$

Then set

$$\boxed{\tilde{\mathcal{E}}^{h} := \left\{ \tilde{\boldsymbol{\gamma}}^{h} \in \tilde{\mathcal{E}} \;\middle|\; \tilde{\boldsymbol{\gamma}}^{h} = \sum_{e=1}^{n_{\mathrm{elm}}} \tilde{\boldsymbol{\gamma}}_e(\boldsymbol{\xi})\chi_e, \text{ with } \tilde{\boldsymbol{\gamma}}_e(\boldsymbol{\xi}) = \mathbf{G}(\boldsymbol{\xi})\boldsymbol{\alpha}_e, \text{ and } \boldsymbol{\alpha}_e \in \mathbb{R}^{n_{\tilde{\varepsilon}}} \right\}} \tag{16}$$

<!-- header/footer: CLASS OF MIXED ASSUMED STRAIN METHODS 1599 -->
