# A CLASS OF MIXED ASSUMED STRAIN METHODS AND THE METHOD OF INCOMPATIBLE MODES*

'. . . *two wrongs do make a right in California*' G. STRANG (1973)

'. . . *two rights make a right even in California*' R. L. TAYLOR (1989)

J. C. SIMO† AND M. S. RIFAI‡

*Division of Applied Mechanics, Department of Mechanical Engineering, Stanford University, Stanford, CA 94305, U.S.A.*

## SUMMARY

A three-field mixed formulation in terms of displacements, stresses and an *enhanced strain* field is presented which encompasses, as a particular case, the classical method of incompatible modes. Within this framework, incompatible elements arise as particular 'compatible' mixed approximations of the enhanced strain field. The conditions that the stress interpolation contain piece-wise constant functions and be $L_2$-orthogonal to the enhanced strain interpolation, ensure satisfaction of the patch test and allow the elimination of the stress field from the formulation. The preceding conditions are formulated in a form particularly convenient for element design. As an illustration of the methodology three new elements are developed and shown to exhibit good performance: a plane 3D elastic/plastic QUAD, an axisymmetric element and a thick plate bending QUAD. The formulation described herein is suitable for non-linear analysis.

## 1. INTRODUCTION AND MOTIVATION

In recent years, considerable attention has been devoted to the development of low order quadrilateral elements (typically bilinear) which exhibit *high accuracy in coarse meshes*; particularly in *bending dominated situations*. Furthermore, many of these low order elements do not exhibit the well-known 'spurious locking' in the nearly incompressible limit and are, therefore, particularly attractive in general purpose finite element analysis programs. It should be pointed out that, despite the enhanced accuracy of these quadrilaterals, from a numerical analysis standpoint no improvement on the standard (*asymptotic*) interpolation error estimates is typically obtained (see e.g. the analysis in Strang and Fix (Reference 20, p. 174)).

Broadly speaking, recent design and development of low order quadrilaterals with enhanced coarse mesh accuracy falls within the scope of two alternative approaches, referred to as *assumed strain* and *assumed stress* methods in what follows. Representative of the first approach is the pioneering work of Nagtegaal *et al.*$^{10}$ and Willan,$^{28}$ the related $\mathbf{B}$-bar methods of Hughes$^{6}$ and Simo *et al.*,$^{19}$ and the mode-decomposition and Hu–Washizu methods of Belytschko and co-workers; see e.g. Belytschko and Bachrach,$^{4}$ among others. As noted in Simo and Hughes,$^{13}$ all of these assumed strain methods can be cast into a three-field variational framework, and

<!-- footnotes -->
\* Research supported by AFOSR under contract nos. 2-DJA-544 and 2-DJA-771 with Stanford University

† Associate Professor of Applied Mechanics

‡ Graduate Research Assistant

0029–5981/90/081595–44\$22.00

© 1990 by John Wiley & Sons, Ltd.

*Received 5 October 1989*

<!-- header/footer: INTERNATIONAL JOURNAL FOR NUMERICAL METHODS IN ENGINEERING, VOL. 29, 1595–1638 (1990) -->
