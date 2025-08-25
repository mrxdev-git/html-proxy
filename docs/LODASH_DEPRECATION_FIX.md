# Lodash.isequal Deprecation Warning Fix

## Problem
The project was experiencing persistent npm deprecation warnings:
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.
```

This warning appeared during `npm install` and `npm ci` operations due to transitive dependencies in the Crawlee framework that still used the deprecated `lodash.isequal` package.

## Solution
Successfully eliminated the deprecation warning by using npm overrides to replace `lodash.isequal` with the modern `deep-equal` package.

### Implementation
Added the following override to `package.json`:

```json
{
  "overrides": {
    "inflight": "npm:@isaacs/inflight@^1.0.6",
    "rimraf": "^5.0.0",
    "glob": "^10.0.0",
    "lodash.isequal": "npm:deep-equal@^2.2.3"
  }
}
```

### Why This Works
- **`deep-equal`** is a modern, actively maintained package that provides the same deep equality comparison functionality as `lodash.isequal`
- **npm overrides** force all transitive dependencies to use our specified replacement instead of the deprecated package
- **No code changes required** - the replacement is API-compatible with the original package
- **No deprecation warnings** - `deep-equal` is not deprecated and uses modern JavaScript practices

### Verification
After implementing the fix:
1. ✅ `npm install` runs without deprecation warnings
2. ✅ `npm ci` runs cleanly without warnings
3. ✅ All existing functionality remains intact
4. ✅ Crawlee and other dependencies work normally with the replacement

### Alternative Approaches Considered
1. **Node.js native `util.isDeepStrictEqual`** - Would require creating custom wrapper packages
2. **File-based overrides** - Had module resolution issues in test environments
3. **Suppressing warnings** - Only hides the problem without fixing the root cause

### Maintenance Notes
- The `deep-equal` package is actively maintained and follows semantic versioning
- Monitor for Crawlee updates that might remove the `lodash.isequal` dependency entirely
- This solution can be removed once all upstream dependencies migrate away from deprecated packages

## Files Modified
- `package.json` - Added npm override for `lodash.isequal`
- Added `deep-equal@^2.2.3` to devDependencies

## Result
**Complete elimination of lodash.isequal deprecation warnings** while maintaining full functionality and compatibility.
