# Локальный Markdown-трекер

Спецификации хранятся в `.scratch/<feature>/spec.md`, задачи — отдельными файлами `.scratch/<feature>/issues/<NN>-<slug>.md`. Номер задачи и поле `Blocked by` определяют зависимости.

Стандартные метки triage: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. После завершения реализации сохраняется triage-метка и отдельно отмечаются выполненные критерии и состояние реализации; triage и факт выполнения — разные понятия.

Текущий проект — `vox-ai-ui`. Обзор зависимостей — `.scratch/vox-ai-ui/ticket-plan.md`. Критерии проверяются в каждой задаче; реализация backend ведётся отдельно.
