import { CourseWorkspace } from "@/components/course/CourseWorkspace";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseWorkspace id={id} />;
}
