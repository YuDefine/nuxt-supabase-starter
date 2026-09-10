// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/testcontainer/src/index.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/testcontainer/src/index.ts
// @specformula/testcontainer — Layer 4: Testcontainers auto-setup
export {
  createContainer,
  provisionIsolatedUser,
  startContainer,
  stopContainer,
  createDataSourceForContainer,
  createDatabase,
  createIsolatedUserForDatabase,
  type ContainerOptions,
  type ProvisionContext,
  type IsolatedCredentials,
  type ContainerInfo,
} from './TestcontainerFactory.js';
