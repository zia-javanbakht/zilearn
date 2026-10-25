[Figure image]

Figure 4. Illustration of the periodic geometry of the RVE with complementary fibers.

To determine if an element should be deleted, the stress tensor components are compared with a predefined tensile strength limit, $\sigma_t$. If any component of the stress tensor exceeds $\sigma_t$ , the element is considered to have failed.

A local damage variable, $d_f$, is also introduced into the constitutive model which evolves based on the stress state of the element. Initially, $d_f$ is set to 0, indicating no damage. The damage variable is updated using the following rule:

$$d_f = \begin{cases} 1 & \text{if } \max\left(\sigma_{ij}\right) \geq \sigma_t \\ 0 & \text{otherwise} \end{cases} \tag{2}$$

If the maximum stress exceeds $\sigma_t$, $d_f$ is set to 1, signifying that the element has failed and should be deleted. This damage variable in incorporated into the stress tensor as below:

$$\sigma_{ij} = \left(1 - d_f\right)\sigma_{ij} \tag{3}$$

This micro-scale stress adjustment ensures that once the element in each fiber reaches the tensile strength limit that is $d_f = 1$, its contribution to the overall material stiffness and load-bearing capacity is nullified.

<!-- header/footer: 1216 Journal of Sandwich Structures & Materials 26(7) -->
