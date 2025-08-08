# Wire EDM Issue Fix Command

You are tasked with analyzing and fixing issues in the Wire EDM G-Code Viewer application. This command works in two modes:

## Mode 1: No Arguments (Discussion Mode)
If no arguments are provided, you should:
1. Read both @ISSUES.md and @FIXED_ISSUES.md files
2. Analyze the current priority list and active issues
3. Identify the most critical foundational issue using bottom-up approach:
   - Prioritize issues that other fixes depend on (foundational/grounding fixes)
   - Avoid surface-level fixes that don't address root causes
   - Consider technical dependencies between issues
4. Present your analysis and recommendation to the user
5. Wait for user confirmation before proceeding

## Mode 2: Specific Issue (Direct Mode)
If arguments are provided, you should:
1. Read both @ISSUES.md and @FIXED_ISSUES.md files
2. Locate the specific issue mentioned in: $ARGUMENTS
3. Focus exclusively on that issue for analysis and fixing

## Critical Understanding Phase
Before starting ANY work, ensure you have a crisp understanding of the issue by:

### Technical Analysis
- Read relevant source code files
- Understand the root cause and technical context
- Identify dependencies and potential side effects
- Review previous attempts and their outcomes

### Clarification Process
Ask targeted questions about:
- Expected behavior vs current behavior
- Specific reproduction steps
- Browser/environment details
- Any constraints or preferences

### Research Activities
When needed, conduct:
- Online research for similar issues
- Documentation review for frameworks/libraries used
- Architecture analysis for system-wide impacts

### Testing Strategy
Develop a testing plan:
- Specific test cases to verify the fix
- Regression testing for related functionality
- Performance impact assessment

## Implementation Approach
1. **Small, Clear Steps**: Break down the fix into precise, manageable tasks
2. **Validation Points**: Stop after each major step for user feedback
3. **Documentation**: Update tracking files with findings and changes
4. **Testing**: Provide specific testing instructions for validation

## Documentation Requirements
- Update @ISSUES.md with progress and findings
- Move completed issues to @FIXED_ISSUES.md with proper formatting
- Include timestamps, root cause analysis, and technical details
- Follow the established formatting rules in both files

## Working Style
- Work incrementally with frequent check-ins
- Provide clear, actionable testing instructions
- Ask for feedback before proceeding to next major step
- Document all changes and findings thoroughly

---

**Target Issue**: $ARGUMENTS

Begin by reading the current issue tracking files and either recommend the most critical issue (if no arguments) or analyze the specified issue (if arguments provided).