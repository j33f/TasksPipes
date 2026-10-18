# Model files

Pipe types and task types (models) can be shared between TasksPipes instances, or kept under version control, as
YAML files.

- **Export**: in **Models**, the *Export* button of a type downloads it. Exporting a pipe type also writes the custom
  task types it offers, so that the file stands on its own; built-in task types are referred to by their id.
  *Export my models* downloads all the models you made. Labels are written in the language of your page.
- **Import**: *Import…* in **Models** reads a file and creates its types as **new private models** of yours, whatever
  their visibility was; make them public from the editor when you are ready. A file is imported all or nothing: if
  one type is not valid, nothing is created and the error says why.

## Format

```yaml
taskspipes: 1                 # format version (required)

taskTypes:                    # optional
  - id: company_visit         # used by the pipe types of the same file
    label: Company visit
    group: Work-study         # category in Models (optional)
    description: A visit to a learner's company.
    icon: briefcase
    fields:
      - id: company
        label: Company
        type: text
      - id: result
        label: Result
        type: select
        options: [OK, To redo]
        hint: How the visit went.

pipeTypes:                    # optional
  - id: work_study
    label: Work-study
    group: Training
    description: Follow-up of work-study learners.
    icon: graduation
    color: "#9E5CF7"
    confidential: true        # always private (optional)
    teamOnly: false           # reserved to a team space (optional)
    columns:                  # two or more, at least one "done"
      - { id: to_plan, label: To plan, status: backlog, color: "#66778F" }
      - { id: visit, label: Visit planned, status: ready, color: "#2BC2FF", wipLimit: 5 }   # limit (optional)
      - { id: closed, label: Closed, status: done, color: "#3ad984" }
    taskTypes: [company_visit, cours]   # task types of this file, or built-in / available ones
    templates:                # starter tasks (optional)
      - Sign the work-study contract
```

- **Column states**: `backlog`, `ready`, `started`, `ongoing`, `blocked`, `done`, `abandoned`.
- **Field types**: `text`, `textarea`, `number`, `money`, `date`, `url`, `email`, `phone`, `select`, `multiselect`
  (with `options`), `checkbox`, `user`, `rncp`, `docs`, `files`.
- **Icons**: the names offered by the icon picker (`pipe`, `star`, `flag`, `check`, `book`, `graduation`, `users`…).
- **Ids** (`id`) are optional: they are made from the labels when missing. The ids of the file's task types are only
  used to link them to its pipe types; imported types get new ids.

The rules are those of the designer: same limits (15 columns, 40 fields, 50 starter tasks), and a pipe type may only
offer task types you can use. A file holds at most 100 models.
