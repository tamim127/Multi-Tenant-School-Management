# Separate academic models

Academic models are not interchangeable names on one generic class table. Phase 2 implements configurable structures; student enrollment, progression and assessment remain future bounded contexts. Phase 1 provisioning still does not force an academic structure.

| Concept           | School                                | College                                                 | University                                                       |
| ----------------- | ------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| Organization      | School → campus                       | College → campus → department                           | University → faculty/school → department; campuses are locations |
| Time              | Academic year → terms                 | Academic session → year/semester                        | Academic calendar → terms/semesters                              |
| Program structure | Grade level → section                 | Program/track → cohort/batch → year/semester → section  | Degree program → curriculum version → requirements               |
| Teaching          | Grade subject assignment to section   | Program subject/course offering for cohort and period   | Catalog course → term offering → class/lab sections              |
| Enrollment        | Student in grade and section for year | Student in program/cohort; period enrollment            | Student program admission plus per-term course registration      |
| Progression       | Promotion/repetition by grade         | Program/cohort progression with credit or subject rules | Prerequisites, credits, attempts, standing, degree audit         |
| Assessment later  | Term and subject results              | Subject/course results under program rules              | Offering assessments and transcript attempts                     |

School must preserve section changes and annual enrollment history; a student's current grade is not an identity attribute. College is explicitly modeled as a program/cohort institution (including higher-secondary or affiliated degree programs), with configurable local progression rules. University requires independent course catalog versions, offerings, registrations, credit loads, prerequisite rules and repeated attempts. A shared global `User` must not stand in for a student academic record.

Future contexts may share tenant, campus, person references and calendar primitives when semantics match. They must not share a polymorphic `class_id` pretending to mean a school grade, college cohort and university course section. Every tenant-owned reference includes tenant ID in a composite foreign key. Cross-context changes use explicit services/events with stable IDs, never writes into another module's tables. Introducing college or university presets requires dedicated versioned presets and validation rather than toggling the School v1 terminology JSON.
