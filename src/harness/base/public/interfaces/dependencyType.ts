/**
 * Extensible neutral dependency classification categories for environment profiles.
 */
export type DependencyType =
    'Database' |
    'InternalApi' |
    'ExternalApi' |
    'MessageQueue' |
    'BlobStorage' |
    'Cache' |
    'FileSystem' |
    'AuthenticationProvider' |
    'IdentityProvider' |
    'EmailService' |
    'NotificationService' |
    'SearchService' |
    'ConfigurationProvider' |
    'ThirdPartyService' |
    (string & {});
