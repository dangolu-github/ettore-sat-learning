# Ettore SAT Reading and Writing Workspace

Student-facing GitHub Pages portal for Ettore's SAT Reading and Writing course.

## Routes

- `/` — learner workspace: Class Logbook (one page per taught class, newest first) and Mistake Logbook
- `/YYYY-MM-DD/` — one class page with three sections: Class Handout, Class Summary, HM
- `/mistake-log/` — server-backed Mistake Logbook with checked mistakes and retry states

No Mock practice and no Target Practice sets are published for this course.

## Access and privacy

The learner enters the course password once in a browser. A successful entry stores an opaque trusted-browser credential—not the password—and silently renews short-lived access on later visits. A new browser or device, private browsing, or cleared site data requires the password again.

The Teacher Portal remains Google owner-only and never asks the teacher for Ettore's password.

The repository and static assets are public, so answer keys, teacher notes, source maps, internal question IDs, question texts of class homework, learner responses, scores, and private records stay outside this repository. All learner routes use `noindex` metadata. Homework pages preserve drafts and require a visible learner-controlled submit action.
