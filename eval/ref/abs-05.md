and the previous fibers is greater than the tolerance value defined by the user. Values of the parameters inputted to the *Python* code are shown in Table 1.

In this study, the effect of $V_{f-L}$ on the pseudo-ductile behavior of the composite under tensile load was investigated by considering four different fiber volume fractions in the middle ply namely, 10%, 20%, 30%, and 40% (Figure 2).

## Material properties

In this study, the 736LT epoxy was considered for the matrix part of the composite and T800 and K63720 carbon fibers were considered as high and low failure strain materials, respectively. The mechanical properties of the carbon fibers and the epoxy used in the modelled composites are given in Table 2. According to Sapozhnikov et al. work,$^{15}$ using certain volume fractions of these carbon fibers in a hybrid composite can result in a pseudo-ductile tensile response. In this study, the effect of volume fraction of carbon fibers on the mechanical response of composite is investigated to estimate the amount of carbon fibers required for obtaining a pseudo-ductile tensile response.

On the fibers surface, some flaws exist which are made during the production process. Distribution of flaws on the surface of fibers can be different leading to a difference between the tensile strength of individual fibers. Thus, a suitable strength distribution function should be considered for the tensile strength of fibers. It has recently been shown that Weibull statistical function is suitable for distribution of the tensile strength of brittle fibers such as carbon and glass fibers.$^{23–25}$ The Weibull modulus is a fundamental parameter within the Weibull function that governs the range of strength distribution. A low Weibull modulus indicates a significant degree of variability in fiber strengths, thereby resulting in a wide spectrum of failure behaviors. Conversely, a high Weibull modulus signifies a more uniform distribution of fiber strengths, leading to more predictable patterns of failure. In accordance with Weibull statistics, the strength of each fiber can be determined as follows:

$$\sigma = \sigma_0 \left[ \ln\left( \frac{1}{1-\eta} \right) \right]^{\frac{1}{m}} \tag{1}$$

where $\eta$ is a random number in [0,1], $\sigma_0$ and $m$ are average ultimate tensile strength of fibers and Weibull modulus, respectively, and their values for the simulated RVEs are given in Table 2.

To model the failure behavior of each component of the composite, a user-defined material subroutine (UMAT) was developed in Fortran that can be linked with the

Table 1. Geometrical parameters of the model.

| $R_f$ (mm) | $V_{f-L}$ | $V_{f-H}$ | $2t_H = 2t_L$ (mm) | width = depth (mm) |
|---|---|---|---|---|
| 0.0065 | 0.1, 0.2, 0.3, 0.4 | 0.45 | 0.15 | 15-40 × $R_f$ |

<!-- header/footer: Abdellahi et al. 1213 -->
