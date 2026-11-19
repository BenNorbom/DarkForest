# Repository workflow

When you finish a task in this repository, commit the completed changes and push them to the configured `origin` remote unless the user explicitly asks you not to. Check `git status` first, include only task-related files, and report the commit and push result. Do not commit secrets, credentials, or local runtime data.

When you make changes that affect the app, automatically update the locally installed app as part of the task using the repository's existing build/install workflow. Do not leave the app outdated after changing its source; rebuild, install, or restart it as needed to apply the changes.
