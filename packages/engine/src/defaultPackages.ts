import defaultBundleJson from "../../../vendor/ShortCircuit-Packages/dist/packages.json";
import {
  createPackageCatalog,
  type PackageBundle,
} from "./packages";

/**
 * The package snapshot bundled for the web studio. The CLI does not import
 * this module, so its build stays independent of the default registry snapshot.
 */
export const DEFAULT_PACKAGE_BUNDLE = defaultBundleJson as unknown as PackageBundle;

/**
 * The default package catalog used by the editor and docs. Compilation builds
 * its own catalog from the current options, so this constant is safe to use for
 * read-only metadata such as completions.
 */
export const DEFAULT_PACKAGE_CATALOG = createPackageCatalog([DEFAULT_PACKAGE_BUNDLE]);

/** Public macros from the default packages, in manifest order. */
export const DEFAULT_PACKAGE_MACROS = [...DEFAULT_PACKAGE_CATALOG.macros.values()].filter(
  (macro) => !macro.internal,
);

/** Public package circuits from the default packages, in manifest order. */
export const DEFAULT_PACKAGE_CIRCUITS = DEFAULT_PACKAGE_CATALOG.circuits;
