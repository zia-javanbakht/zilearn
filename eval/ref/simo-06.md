Here, $\boldsymbol{\alpha}_e$ are $n_{\tilde{\varepsilon}}$-local element strain parameters, and $\mathbf{G}(\boldsymbol{\xi})$ is a matrix of $\mathbb{R}^{n_{\mathrm{sym}}} \times \mathbb{R}^{n_{\tilde{\varepsilon}}}$ prescribed functions with linearly independent columns, which define the enhanced strain interpolation. If the space $\tilde{\mathcal{E}}^{h}$ is to 'enhance' the standard strain field derived from the displacement approximation, it is natural to require that compatible strains of the form $(14)_2$ *are not* included *in* $\tilde{\mathcal{E}}^{h}$. More precisely, let

$$\nabla^{s}\mathcal{V}^{h} := \left\{ \boldsymbol{\gamma}^{h} \in \mathcal{E} \;\middle|\; \boldsymbol{\gamma}^{h} = \sum_{e=1}^{n_{\mathrm{elm}}} \boldsymbol{\gamma}_e(\boldsymbol{\xi})\chi_e, \text{ with } \boldsymbol{\gamma}_e(\boldsymbol{\xi}) = \mathbf{B}(\boldsymbol{\xi})\mathbf{d}_e \right\} \tag{17}$$

denote the space of standard strain fields. Then we require

*Condition* (*i*). The enhanced strain interpolation $\tilde{\mathcal{E}}^{h}$ and the standard strain interpolation defined by $\nabla^{s}\mathcal{V}^{h}$ are *independent* in the sense that

$$\boxed{\tilde{\mathcal{E}}^{h} \cap \nabla^{s}\mathcal{V}^{h} = \varnothing} \tag{18}$$

In addition, we assume that the columns of $\mathbf{G}(\boldsymbol{\xi})$ are *linearly independent*.

Requirement (18) is the crucial condition which ensures *stability* of the enhanced strain approximation. In particular, as shown in Section 4, violation of (18) leads to a singular system of equations. The admissible choices of functions $\mathbf{G}(\boldsymbol{\xi})$ are intimately related to the structure of the approximating stress subspace $S^{h}$, as discussed below.

#### 2.2.2. *The assumed discrete stress field.*

We consider finite element stress fields $\boldsymbol{\tau}^{h} \in S^{h}$ also *discontinuous* across element boundaries; i.e. of the form

$$\boldsymbol{\tau}^{h} = \sum_{e=1}^{n_{\mathrm{elm}}} \boldsymbol{\tau}_e(\boldsymbol{\xi})\chi_e \tag{19}$$

where $\boldsymbol{\tau}_e(\boldsymbol{\xi})$ is the assumed stress field over a typical element $\mathcal{B}_e$. We then eliminate the explicit appearance of the stress field in our finite element approximation by choosing $S^{h}$ orthogonal to $\tilde{\mathcal{E}}^{h}$; i.e.

*Condition* (*ii*). $S^{h}$ and $\tilde{\mathcal{E}}^{h}$ are $L_2$-*orthogonal*. Since any $(\tilde{\boldsymbol{\gamma}}^{h}, \boldsymbol{\tau}^{h}) \in \tilde{\mathcal{E}}^{h} \times S^{h}$ is discontinuous across element boundaries, (16) and (19) imply

$$\boxed{\langle \boldsymbol{\tau}_e, \tilde{\boldsymbol{\gamma}}_e \rangle_{L_2} := \int_{\mathcal{B}_e} \tilde{\boldsymbol{\gamma}}_e(\boldsymbol{\xi})\cdot\boldsymbol{\tau}_e(\boldsymbol{\xi})\, \mathrm{d}V = \boldsymbol{\alpha}_e \cdot \int_{\mathcal{B}_e} \mathbf{G}^{\mathrm{T}}(\boldsymbol{\xi})\boldsymbol{\tau}_e(\boldsymbol{\xi})\, \mathrm{d}V = 0} \tag{20}$$

for any element $e = 1, 2, \ldots, n_{\mathrm{elm}}$.

As a result of this condition, equation $(9)_2$ is identically satisfied, and the first term in $(9)_3$ vanishes. Hence, condition (ii) (above) effectively eliminates the stress field from the finite element equations. However, given an interpolation space $\tilde{\mathcal{E}}^{h}$ of enhanced strain fields, the orthogonality condition (ii) (above) may produce an overly constrained space $S^{h}$ which would preclude convergence of the method. We prevent such a situation by requiring

<!-- header/footer: 1600 J. C. SIMO AND M. S. RIFAI -->
