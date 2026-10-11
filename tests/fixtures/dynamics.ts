import { createCourse, insertMaterial, listTopics, replaceLinks, replaceTopics, type NewTopic } from "@/lib/store";

/**
 * A small structural dynamics course with lecture notes, a lecture transcript and a tutorial sheet, used to
 * test lesson generation on realistic material (formulas, timestamps, worked problems).
 */
export const NOTES = `# Lecture 3: Free vibration of SDOF systems

## Equation of motion
For a mass $m$ on a spring of stiffness $k$ with a viscous damper $c$, Newton's second law gives
$$m\\ddot{u} + c\\dot{u} + ku = 0.$$
Dividing by $m$ and writing $\\omega_n = \\sqrt{k/m}$ (natural circular frequency) and $\\zeta = c/c_{cr}$ (damping ratio), with critical damping $c_{cr} = 2m\\omega_n = 2\\sqrt{km}$:
$$\\ddot{u} + 2\\zeta\\omega_n\\dot{u} + \\omega_n^2 u = 0.$$

## Damped free vibration
Trying $u = e^{st}$ gives the characteristic equation $s^2 + 2\\zeta\\omega_n s + \\omega_n^2 = 0$ with roots $s = -\\zeta\\omega_n \\pm \\omega_n\\sqrt{\\zeta^2 - 1}$.
- Underdamped ($\\zeta < 1$): the system oscillates with decaying amplitude.
- Critically damped ($\\zeta = 1$): returns to rest fastest without oscillating.
- Overdamped ($\\zeta > 1$): returns slowly without oscillating.

For the underdamped case the response to initial displacement $u(0)$ and velocity $\\dot u(0)$ is
$$u(t) = e^{-\\zeta\\omega_n t}\\left[u(0)\\cos\\omega_D t + \\frac{\\dot u(0) + \\zeta\\omega_n u(0)}{\\omega_D}\\sin\\omega_D t\\right]$$
where $\\omega_D = \\omega_n\\sqrt{1-\\zeta^2}$ is the damped natural frequency. For typical structures $\\zeta < 0.2$ so $\\omega_D \\approx \\omega_n$.

## Logarithmic decrement
The ratio of two successive peaks is $u_i/u_{i+1} = e^{2\\pi\\zeta/\\sqrt{1-\\zeta^2}}$. The logarithmic decrement $\\delta = \\ln(u_i/u_{i+1}) \\approx 2\\pi\\zeta$ for small damping. Over $j$ cycles: $\\zeta \\approx \\frac{1}{2\\pi j}\\ln\\frac{u_i}{u_{i+j}}$.
This is how damping is measured in a free vibration (pluck) test.

## Typical damping ratios
| Structure | $\\zeta$ |
|---|---|
| Welded steel frame | 2% |
| Reinforced concrete (uncracked) | 2-3% |
| Reinforced concrete (cracked) | 3-5% |
| Timber, bolted steel | 5-7% |
`;

export const TRANSCRIPT = `[00:00] OK so today we pick up from last week. Last week we had the undamped oscillator, right, the mass just keeps going forever.
[00:41] In reality that never happens. If you pluck a building, if you push a floor, the motion dies out. That's damping.
[01:30] Now, we model damping as a viscous dashpot, force proportional to velocity. Is that what really happens in a building? No. It's friction in connections, cracking in concrete, all sorts. But viscous damping is mathematically convenient and it works well enough for small damping.
[03:12] So we get m u double dot plus c u dot plus k u equals zero. Divide through by m. And I define zeta, the damping ratio, as c over c critical.
[05:05] What's critical damping? It's the smallest damping for which the system doesn't oscillate at all. Think of a door closer. A good door closer is close to critically damped, it shuts the door as fast as possible without slamming and bouncing.
[07:40] Most of you will mix this up in the exam: zeta equals one is critical, not zeta equals zero. Zero damping is the undamped case.
[09:15] For buildings zeta is tiny, two to five percent. So omega D and omega n are practically the same. Don't waste time in the exam computing omega D to six decimals when zeta is 0.05.
[12:30] How do we get zeta for a real structure? We measure it. We give it a push, record the decay, and look at the peaks. Each peak is smaller by the same ratio. Take the log of that ratio, that's the log decrement delta, and zeta is roughly delta over two pi.
[15:50] If the peaks are noisy, count several cycles. Peak one, peak eleven, ten cycles, divide by two pi times ten. Much more accurate.
[18:20] Next week: what happens when we keep pushing, forced vibration, and resonance.`;

export const TUTORIAL = `# Tutorial 3: Damped free vibration

Q1. A one-storey frame has mass 20 t and lateral stiffness 8000 kN/m. A pull-back test displaces the roof 25 mm and releases it. After 5 complete cycles the amplitude is 12 mm.
(a) Find the natural period. (b) Find the damping ratio. (c) Find the damping coefficient c.

Q2. Show that for zeta = 0.05 the damped and undamped natural frequencies differ by less than 0.2%.

Q3. A system has zeta = 1.2. Sketch u(t) after a release from u(0) = u0 with zero velocity. Does it cross zero?`;

const t = (ref: string, parent_ref: string | null, title: string, summary: string, keywords: string[] = []): NewTopic => ({ ref, parent_ref, title, summary, keywords, material_ids: [], importance: 2 });

export function dynamicsCourse() {
  const course = createCourse({ name: "Structural Dynamics" });
  const control = createCourse({ name: "Control Systems" });
  const base = { course_id: course.id, source_type: "file" as const, mime: null, path: null, url: null, status: "ready" as const, note: null };
  const notes = insertMaterial({ ...base, kind: "lecture_notes", title: "Lecture 3 notes", filename: "lec3.md", text: NOTES });
  const video = insertMaterial({ ...base, kind: "video", title: "Lecture 3 recording", filename: "lec3.mp4", text: TRANSCRIPT });
  const tut = insertMaterial({ ...base, kind: "tutorial", title: "Tutorial 3", filename: "tut3.md", text: TUTORIAL });
  const ids = [notes.id, video.id, tut.id];
  replaceTopics(course.id, [
    t("1", null, "SDOF systems", "Single-degree-of-freedom idealisation of structures."),
    t("1.1", "1", "Equation of motion", "Newton's law for mass, spring and damper: m u'' + c u' + k u = p(t)."),
    t("1.2", "1", "Undamped free vibration", "Harmonic motion at the natural frequency omega_n = sqrt(k/m)."),
    { ...t("1.3", "1", "Damped free vibration", "Free vibration with viscous damping: underdamped, critically damped and overdamped response; damping ratio and its measurement.", ["damping ratio", "critical damping", "logarithmic decrement", "damped natural frequency"]), material_ids: ids },
    t("1.3.1", "1.3", "Logarithmic decrement", "Measuring damping from the decay of free vibration peaks."),
    t("1.3.2", "1.3", "Critical damping", "The smallest damping with no oscillation."),
    t("1.4", "1", "Forced harmonic vibration", "Response to harmonic loading; resonance and dynamic amplification."),
  ]);
  replaceTopics(control.id, [t("1", null, "Second-order systems", "Step response of second-order systems: natural frequency, damping ratio, overshoot.")]);
  const topic = listTopics(course.id).find((x) => x.title === "Damped free vibration")!;
  replaceLinks([{ from_topic: topic.id, to_topic: listTopics(control.id)[0].id, score: 0.7, relation: "the same equation and damping ratio, written for control loops" }]);
  return { course, topic };
}
