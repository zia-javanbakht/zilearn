// Every test file starts on an in-memory database, so no test reads or writes the real one
// (which may hold AI keys saved in Settings and would turn on real API calls).
import { openDb, setDb } from "@/lib/db";

setDb(openDb(":memory:"));
