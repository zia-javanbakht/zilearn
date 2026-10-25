<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 1/6 -->

## Isoparametric Mapping: Natural, Physical, and Global Coordinates

[Figure image]

Figure 1. Natural $(\xi, \eta)$, local/physical $(x', y')$, and global $(X, Y)$ coordinates, connected by the isoparametric mapping and the Jacobian.

**Definition 1.1 — Isoparametric Concept.** The same shape functions $N_i(\xi, \eta)$ interpolate both geometry and the displacement field:

$$\mathbf{x} = \sum_i N_i(\xi, \eta)\,\mathbf{x}_i, \qquad \mathbf{u} = \sum_i N_i(\xi, \eta)\,\mathbf{u}_i$$

mapping the fixed reference (parent) element onto the arbitrary physical shape of each element, which is then placed into the assembled global mesh.

**Keypoint 1.1 — Role of the Jacobian.** The Jacobian $\mathbf{J} = \partial(x, y)/\partial(\xi, \eta)$ is the link between natural and physical space: it converts derivatives ($\mathbf{B} = \mathbf{J}^{-1}\nabla_\xi\mathbf{N}$) and differential area/volume ($\mathrm{d}A = \det(\mathbf{J})\,\mathrm{d}\xi\,\mathrm{d}\eta$).
