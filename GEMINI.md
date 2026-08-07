# GEMINI.md - Antigravity Project AI Guidelines

This document defines the strict coding standards, architectural principles, and testing rules for the **Antigravity** project. Whenever Gemini (or any AI) generates, refactors, or reviews code for this repository, it MUST adhere strictly to these guidelines.

## 1. Role & Context
- **Primary Stack:** Unity (C#), companion applications (Node.js/Python).
- **Methodology:** Agile (Sprints, Daily Stand-ups, User Stories).
- **Goal:** Maintain zero technical debt, highly scalable architecture, and maximum readability.

## 2. Clean Code & Architecture
- **SOLID Principles:**
  - Code must adhere strictly to SRP (Single Responsibility Principle) and OCP (Open/Closed Principle).
  - Interfaces should be segregated (ISP) and dependency injection (DIP) used extensively.
- **Composition over Inheritance:** Avoid deep class hierarchies. Use interfaces and composition to share behavior.
- **KISS & DRY:** Keep methods short (under 20 lines). Extract duplicate logic into shared utilities or base services.
- **No Magic Numbers:** All constants, configuration values, and string literals must be extracted to `const`, `readonly`, or configuration files.

## 3. Naming Conventions (C# / Unity)
- **Classes & Structs:** `PascalCase` (e.g., `TimeTracker`, `BusyBarController`).
- **Interfaces:** `IPascalCase` (e.g., `ITaskService`).
- **Methods:** `PascalCase` (e.g., `UpdateTimer()`, `SendStatus()`).
- **Public Properties:** `PascalCase` (e.g., `CurrentState`).
- **Local Variables & Parameters:** `camelCase` (e.g., `timeRemaining`, `appId`).
- **Private Fields:** `_camelCase` (e.g., `_httpClient`, `_timerSettings`).
- **Constants:** `PascalCase` or `UPPER_SNAKE_CASE` depending on context, but be consistent.
- **Booleans:** Prefix with `is`, `has`, `can`, or `should` (e.g., `isTimerRunning`, `hasConnection`).

## 4. Code Coverage & Testing
- **Target Coverage:** Minimum 80% code coverage for all business logic.
- **Test-Driven Development (TDD):** Write tests to validate edge cases, happy paths, and error states.
- **Unit Tests:** Use NUnit / Unity Test Framework.
- **Mocking:** Abstract external dependencies (like the BUSY Bar HTTP API, Unity's `Time`, or file systems) behind interfaces and mock them in tests using NSubstitute or Moq.
- **Test Naming:** Use the `MethodName_StateUnderTest_ExpectedBehavior` convention (e.g., `UploadAsset_ValidFile_ReturnsSuccess`).

## 5. Defensive Programming & Error Handling
- **Fail Fast:** Validate method arguments immediately. Throw `ArgumentNullException` or `ArgumentException` at the top of the method.
- **Null Checks:** Use C# 8+ nullable reference types and null-conditional operators (`?.`, `??`).
- **Try/Catch:** Only catch specific exceptions. Never use empty `catch` blocks or catch generic `Exception` unless at the top-level application crash handler.
- **Logging:** Log warnings for unexpected states and errors for failures. Include context in logs (e.g., `[BUSYBarAPI] Failed to upload asset: {fileName} - {ErrorCode}`).

## 6. Unity Specific Rules
- **Update() Loops:** Keep logic in `Update()` to an absolute minimum. Defer logic to events, coroutines, or async/await.
- **Component Decoupling:** Use ScriptableObjects, events, or Dependency Injection (e.g., Zenject/VContainer) to decouple MonoBehaviours.
- **Async/Await:** Prefer `async/await` with `Task` or `UniTask` over Coroutines for API calls and file I/O.

## 7. AI Code Generation Instructions
- **Do not apologize** or use excessive conversational filler. Output the code immediately.
- **Provide complete blocks.** Do not use `// ... rest of code`. If modifying a method, rewrite the full method.
- **Document the "Why".** Add XML comments (`///`) to public methods and classes explaining *why* something is done, not *what* it does (the code should tell what it does).
