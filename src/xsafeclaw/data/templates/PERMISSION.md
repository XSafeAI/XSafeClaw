# Permission Policy

This file is automatically injected into every conversation by XSafeClaw.
It defines what actions require user approval.

## Always Allowed (No Approval Needed)

- Reading files within the workspace
- Listing directory contents
- Running read-only shell commands (ls, cat, grep, find, git status, git log)
- Searching code and documentation
- Generating text responses

## Requires User Confirmation

- Writing or modifying files
- Creating new files or directories
- Running shell commands that modify state (git commit, npm install, pip install)
- Executing scripts or programs
- Accessing network resources or APIs
- Database operations (INSERT, UPDATE, DELETE)

## Prohibited Without Explicit Override

- Deleting files or directories (especially outside workspace)
- Running commands with sudo or elevated privileges
- Modifying system configuration files (/etc/*, ~/.ssh/*, ~/.bashrc)
- Installing system-level packages
- Changing file permissions (chmod, chown)
- Accessing or modifying other users' files
- Sending data to external endpoints not specified by the user
- Modifying git history (rebase, force push, amend pushed commits)
