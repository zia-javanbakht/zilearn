<!-- header/footer: Topic 7—Lecture Notes; Dr Zia Javanbakht; Isoparametric Elements; Natural and Physical (Local/Global) Coordinates; Definition of Jacobian Matrix; Isoparameteric vs Generic FE Flow; Mesh; Element Quality; Refinement Strategies; Convergence in Practice: $u$ vs $\sigma$; References; 5/6 -->

## Mesh Refinement Strategies

**Definition 2.1 — h-, p-, and hp-Refinement.** Classical strategies for improving FE accuracy are (Cook et al. 2002):

- **h-refinement:** reduce element size $h$, fixed $p$
- **p-refinement:** increase polynomial order $p$, fixed mesh
- **hp-refinement:** combine both for optimal convergence
- **r-refinesment:** mesh and order is the same, discretisation arrangement changes

Refining the mesh ($h\downarrow$) and/or raising element order ($p\uparrow$) both reduce error — smooth solutions benefit most from $p$; singular solutions are limited by regularity $m$ regardless of $p$.

**Keypoint 2.1 — Convergence Rates.** For smooth solutions, $p$-refinement gives exponential convergence; $h$-refinement gives algebraic convergence, $O(h^{p+1})$ in displacement and $O(h^p)$ in stress.

[Figure image]

Figure 4. Graded mesh (non-uniform mesh): refinements from a coarse to fine mesh region are concentrated near a stress concentration (Hellen & Becker 2017).
