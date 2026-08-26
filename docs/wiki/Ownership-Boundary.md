# Ownership Boundary

Every reusable test harness eventually faces the same pressure. A team needs one more thing from it, that thing happens to be specific to their provider or their product, and adding it is easier than building it on their own side. Do that a few times and the harness only works for the application that pushed hardest.

This page draws the line so that pressure has somewhere to land.

## What the package owns

The package owns mechanisms that hold for any dependency, anywhere:

- The test and suite lifecycle, including fixture ordering and file-scoped state
- Readiness gating and the skip behavior that follows from it
- Environment-variable schema evaluation
- The profile container and its metadata
- Paired resource setup and cleanup, LIFO ordering, and setup- and cleanup-failure aggregation
- Diagnostic capture, redaction, and reporter dispatch
- Retry and polling

None of that names a vendor. `evaluateReadiness` runs a function you wrote and reads a boolean; it has no idea whether the function pinged a database or checked a directory. `ResourceTracker` runs a setup callback you supplied and hands its result back to a cleanup callback you supplied; it does not know what it created or what it is deleting.

## What your application owns

Your application owns everything specific:

- Concrete tenant, subscription, storage, and service-specific profiles
- Credentials, and the code that obtains them
- Permission checks and provisioning checks
- Service clients and the code that talks to your dependencies
- Test helpers built on top of any of the above
- Policy about which environments may be tested against, and by whom

That last one deserves emphasis. Rules about which tenant is safe to mutate, which subscription is off limits, or which environment a suite may run against are policy decisions belonging to the application that has to answer for them. Encoding them in a shared package puts one team's rules in another team's dependency.

## Deciding where something belongs

When you are unsure which side a change goes on, ask whether implementing it in the package would require the package to name a vendor, a tenant, or a product rule.

If yes, it belongs in your application. Write it as a readiness check, a profile, a fixture, or a helper. The extension points exist so that this kind of thing has an obvious home outside the package.

If no, and the mechanism would be useful to an application with completely different dependencies, it is a reasonable candidate for the package.

The test is blunt for a reason. A more nuanced rule would be argued around, and the failure mode it guards against is gradual.

## Why the line is drawn here

A harness that knows about one provider stops being reusable by the next application. That is the whole argument, and it has a cost: keeping the boundary means each application writes its own profiles rather than importing ready-made ones, and two applications using the same provider will write similar code.

That duplication is the price. It buys a package that neither application has to fork when their requirements diverge, and it keeps one team's credentials and policy out of the other team's dependency tree.

[Cloud Profiles](Example-Azure-Profiles) shows what the application-owned side looks like in practice: a realistic set of profiles for a directory tenant, a subscription, and a blob container, none of which belongs in the package.
