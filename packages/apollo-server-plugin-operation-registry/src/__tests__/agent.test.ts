import nock from 'nock';
import { InMemoryLRUCache } from 'apollo-server-caching';
import {
  envOverrideOperationManifest,
  envOverrideStorageSecretBaseUrl,
  getStoreKey,
  fakeTestBaseUrl,
} from '../common';
import { resolve as urlResolve } from 'url';
import { AgentOptions } from '../agent';
import {
  defaultAgentOptions,
  nockBase,
  genericLegacyOperationManifestUrl,
  genericStorageSecret,
  genericApiKeyHash,
  genericServiceID,
  defaultStore,
  nockStorageSecretOperationManifest,
  nockStorageSecret,
  nockGoodManifestsUnderStorageSecret,
  nockLegacyGoodManifest,
  genericSchemaHash,
  hashedServiceId,
  defaultTestAgentPollSeconds,
} from './helpers.test-helpers';
import {
  Operation,
  OperationManifest,
} from "../ApolloServerPluginOperationRegistry";

// These get a bit verbose within the tests below, so we use this as a
// sample store to pick and grab from.
const sampleManifestRecords: Record<string, Operation> = {
  a: {
    signature:
      'ba4573fca2e1491fd54b9f398490531ad6327b00610f2c1216dc8c9c4cfd2993',
    document:
      'mutation toggleMovieLike($id:ID!){toggleLike(id:$id){__typename id isLiked}}',
  },
  b: {
    signature:
      '32a21510374c3c9ad25e06424085c45ccde29bdbdedf8fa806c2bc6a2ffcdf56',
    document: '{nooks:books{author}}',
  },
  c: {
    signature:
      'c60ac6dfe19ba70dd9d6a29a275fae56296dcbb636eeaab55c3d9b7287c40a47',
    document: '{nooks:books{__typename author}}',
  },
};

const manifest = (...operations: Operation[]) => ({
  version: 2,
  operations,
});

describe('Agent', () => {
  describe('Basic', () => {
    const Agent = require('../agent').default;
    it('instantiates with proper options', () => {
      expect(new Agent({ ...defaultAgentOptions })).toBeInstanceOf(Agent);
    });

    it('instantiates with debug enabled', () => {
      expect(new Agent({ ...defaultAgentOptions, debug: true })).toBeInstanceOf(
        Agent,
      );
    });

    it('fails to instantiate when `schemaHash` is not passed', () => {
      const { schemaHash, ...remainingOptions } = defaultAgentOptions;
      expect(() => {
        // @ts-ignore: Intentionally not passing the parameter we need.
        new Agent(remainingOptions);
      }).toThrow(/`schemaHash` must be/);
    });
  });

  describe('with manifest', () => {
    let originalEnvApolloOpManifestBaseUrl: string | undefined;
    let originalEnvOverrideStorageSecretBaseUrl: string | undefined;
    let Agent: typeof import('../agent').default;
    let getOperationManifestUrl: typeof import('../common').getOperationManifestUrl;
    let getLegacyOperationManifestUrl: typeof import('../common').getLegacyOperationManifestUrl;
    let urlOperationManifestBase: string;
    let genericStorageSecretOperationManifestUrl: string;

    beforeAll(() => {
      // Override the tests URL with the one we want to mock/nock/test.
      originalEnvApolloOpManifestBaseUrl =
        process.env[envOverrideOperationManifest];
      process.env[envOverrideOperationManifest] = fakeTestBaseUrl;

      originalEnvOverrideStorageSecretBaseUrl =
        process.env[envOverrideStorageSecretBaseUrl];
      process.env[envOverrideStorageSecretBaseUrl] = fakeTestBaseUrl;

      // Reset the modules so they're ready to be imported.
      jest.resetModules();

      // Store these on the local scope after we've reset the modules.
      Agent = require('../agent').default;
      getOperationManifestUrl = require('../common').getOperationManifestUrl;
      getLegacyOperationManifestUrl = require('../common')
        .getLegacyOperationManifestUrl;
      urlOperationManifestBase = require('../common').urlOperationManifestBase;

      genericStorageSecretOperationManifestUrl = getOperationManifestUrl(
        genericServiceID,
        genericStorageSecret,
      ).replace(new RegExp(`^${urlOperationManifestBase}`), '');
    });

    afterAll(() => {
      // Put the environment overrides back how they were.
      if (originalEnvApolloOpManifestBaseUrl) {
        process.env[
          envOverrideOperationManifest
        ] = originalEnvApolloOpManifestBaseUrl;

        originalEnvApolloOpManifestBaseUrl = undefined;
      } else {
        delete process.env[envOverrideOperationManifest];
      }
      if (originalEnvOverrideStorageSecretBaseUrl) {
        process.env[
          envOverrideStorageSecretBaseUrl
        ] = originalEnvOverrideStorageSecretBaseUrl;

        originalEnvOverrideStorageSecretBaseUrl = undefined;
      } else {
        delete process.env[envOverrideStorageSecretBaseUrl];
      }

      // Reset modules again.
      jest.resetModules();
    });

    const forCleanup: {
      store?: InMemoryLRUCache;
      agent?: import('../agent').default;
    }[] = [];

    function createAgent({ ...args }: Partial<AgentOptions> = {}) {
      const options = { ...defaultAgentOptions, ...args };

      // We never actually let the Agent construct its own default store
      // since we need to pluck the store out to instrument it with spies.
      const store = options.store;
      const agent = new Agent(options);

      // Save all agents and stores we've created so we can properly
      // stop them and clean them up.
      forCleanup.push({ agent, store });
      return agent;
    }

    afterEach(() => {
      if (!nock.isDone()) {
        throw new Error(
          `Not all nock interceptors were used! Pending mocks: ${nock.pendingMocks()}`,
        );
      }

      let toCleanup;
      // Loop through the `forCleanup` constant and empty it out by popping
      // individual elements off the end and running the appropriate cleanup.
      while ((toCleanup = forCleanup.pop())) {
        if (toCleanup.agent) {
          toCleanup.agent.stop();
        }
      }
    });

    it('correctly prepared the test environment', () => {
      expect(getLegacyOperationManifestUrl('abc123', 'def456')).toStrictEqual(
        urlResolve(fakeTestBaseUrl, '/abc123/def456.v2.json'),
      );
    });

    describe('manifest checking and store populating', () => {
      function expectStoreSpyOperationEach(
        spy: jest.SpyInstance,
        letters: string[],
      ) {
        letters.forEach(letter => {
          const { signature, document } = sampleManifestRecords[letter];
          expect(spy).toHaveBeenCalledWith(getStoreKey(signature), document);
        });
      }

      async function expectStoreHasOperationEach(
        store: InMemoryLRUCache,
        letters: string[],
      ) {
        for (const letter of letters) {
          const { signature, document } = sampleManifestRecords[letter];
          await expect(
            store.get(getStoreKey(signature)),
          ).resolves.toStrictEqual(document);
        }
      }

      it('logs debug updates to the manifest on startup', async () => {
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockStorageSecretOperationManifest(
          genericServiceID,
          genericStorageSecret,
          404,
        );
        nockLegacyGoodManifest([
          sampleManifestRecords.a,
          sampleManifestRecords.b,
          sampleManifestRecords.c,
        ]);
        const relevantLogs: any = [];
        const logger = {
          debug: jest.fn().mockImplementation((...args: any[]) => {
            if (
              typeof args[0] === 'string' &&
              (args[0].match(/Checking for manifest changes/) ||
                args[0].match(/Incoming manifest ADDs/))
            ) {
              relevantLogs.push(args);
            }
          }),
          warn: jest.fn().mockImplementation((...args: any[]) => {
            if (
              typeof args[0] === 'string' &&
              (args[0].match(/Checking for manifest changes/) ||
                args[0].match(/Incoming manifest ADDs/))
            ) {
              relevantLogs.push(args);
            }
          }),
        };
        await createAgent({ logger }).start();

        expect(relevantLogs[0][0]).toBe(
          `Checking for manifest changes at ${urlResolve(
            fakeTestBaseUrl,
            getOperationManifestUrl(genericServiceID, genericStorageSecret),
          )}`,
        );

        expect(relevantLogs[1][0]).toBe(
          `Checking for manifest changes at ${urlResolve(
            fakeTestBaseUrl,
            getLegacyOperationManifestUrl(
              hashedServiceId(genericServiceID),
              genericSchemaHash,
            ),
          )}`,
        );

        // Console should indicate the records have been added in order.
        expect(relevantLogs[2][0]).toBe(
          `Incoming manifest ADDs: ${sampleManifestRecords.a.signature}`,
        );
        expect(relevantLogs[3][0]).toBe(
          `Incoming manifest ADDs: ${sampleManifestRecords.b.signature}`,
        );
        expect(relevantLogs[4][0]).toBe(
          `Incoming manifest ADDs: ${sampleManifestRecords.c.signature}`,
        );

        expect(relevantLogs.length).toBe(5);

        logger.debug.mockRestore();
      });

      it('populates the manifest store after starting', async () => {
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ],
        );
        const store = defaultStore();
        const storeSetSpy = jest.spyOn(store, 'set');
        await createAgent({ store }).start();

        // There are three operations in the manifest above.
        expect(storeSetSpy).toHaveBeenCalledTimes(3);
        expectStoreSpyOperationEach(storeSetSpy, ['a', 'b', 'c']);
        await expectStoreHasOperationEach(store, ['a', 'b', 'c']);

        storeSetSpy.mockRestore();
      });

      it('starts polling successfully', async () => {
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ],
        );
        const store = defaultStore();
        const storeSetSpy = jest.spyOn(store, 'set');
        const storeDeleteSpy = jest.spyOn(store, 'delete');
        const agent = createAgent({ store });
        jest.useFakeTimers();
        await agent.start();

        // Three additions, no deletions.
        expect(storeSetSpy).toBeCalledTimes(3);
        expect(storeDeleteSpy).toBeCalledTimes(0);

        // Only the initial start-up check should have happened by now.
        expect(agent._timesChecked).toBe(1);

        // If it's one millisecond short of our next poll interval, nothing
        // should have changed yet.
        jest.advanceTimersByTime(defaultTestAgentPollSeconds * 1000 - 1);

        // Still only one check.
        expect(agent._timesChecked).toBe(1);

        // Now, we'll expect another request to go out, so we'll nock it.
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockStorageSecretOperationManifest(
          genericServiceID,
          genericStorageSecret,
          304,
        );

        // If we move forward the last remaining millisecond, we should trigger
        // and end up with a successful sync.
        jest.advanceTimersByTime(1);

        // While that timer will fire, it will do work async, and we need to
        // wait on that work itself.
        await agent.requestPending();

        // Now the times checked should have gone up, and we should log that
        // we are looking for an update.  Of course, since we're unchanged
        // there should be no actual update.
        expect(agent._timesChecked).toBe(2);

        expect(storeSetSpy).toBeCalledTimes(3);
        expect(storeDeleteSpy).toBeCalledTimes(0);
      });

      it('continues polling even after initial failure', async () => {
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockStorageSecretOperationManifest(
          genericServiceID,
          genericStorageSecret,
          500,
        );
        const store = defaultStore();
        const storeSetSpy = jest.spyOn(store, 'set');
        const storeDeleteSpy = jest.spyOn(store, 'delete');
        const agent = createAgent({ store });
        jest.useFakeTimers();
        await agent.start();

        expect(storeSetSpy).toBeCalledTimes(0);
        expect(storeDeleteSpy).toBeCalledTimes(0);

        // Only the initial start-up check should have happened by now.
        expect(agent._timesChecked).toBe(1);

        // If it's one millisecond short of our next poll interval, nothing
        // should have changed yet.
        jest.advanceTimersByTime(defaultTestAgentPollSeconds * 1000 - 1);

        // Still only one check.
        expect(agent._timesChecked).toBe(1);
        expect(storeSetSpy).toBeCalledTimes(0);

        // Now, we'll expect another GOOD request to fulfill, so we'll nock it.
        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ],
        );

        // If we move forward the last remaining millisecond, we should trigger
        // and end up with a successful sync.
        jest.advanceTimersByTime(1);

        // While that timer will fire, it will do work async, and we need to
        // wait on that work itself.
        await agent.requestPending();

        // Now the times checked should have gone up.
        expect(agent._timesChecked).toBe(2);
        // And store should have been called with operations ABC
        expect(storeSetSpy).toBeCalledTimes(3);
      });

      it('purges operations which are removed from the manifest', async () => {
        const store = defaultStore();
        const storeSetSpy = jest.spyOn(store, 'set');
        const storeDeleteSpy = jest.spyOn(store, 'delete');

        // Intentionally not calling start, since we're not testing intervals.
        const agent = createAgent({ store });
        expect(storeSetSpy).toBeCalledTimes(0);

        nockStorageSecret(genericServiceID, genericApiKeyHash);
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ],
        ); // Starting with ABC.
        await agent.checkForUpdate();
        expect(agent._timesChecked).toBe(1);
        expect(storeSetSpy).toBeCalledTimes(3);
        expect(storeDeleteSpy).toBeCalledTimes(0);
        await expectStoreHasOperationEach(store, ['a', 'b', 'c']);

        nockStorageSecret(genericServiceID, genericApiKeyHash)
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [sampleManifestRecords.a, sampleManifestRecords.b],
        ); // Just AB in this manifest.
        await agent.checkForUpdate();
        expect(agent._timesChecked).toBe(2);
        expect(storeSetSpy).toBeCalledTimes(3); // no new sets.
        expect(storeDeleteSpy).toBeCalledTimes(1);
        await expect(
          // Ensure that 'C' is gone!
          store.get(getStoreKey(sampleManifestRecords.c.signature)),
        ).resolves.toBeUndefined();

        nockStorageSecret(genericServiceID, genericApiKeyHash)
        nockGoodManifestsUnderStorageSecret(
          genericServiceID,
          genericStorageSecret,
          [sampleManifestRecords.a]
        ); // Just A in this manifest.
        await agent.checkForUpdate();
        expect(agent._timesChecked).toBe(3);
        expect(storeSetSpy).toBeCalledTimes(3); // no new sets.
        expect(storeDeleteSpy).toBeCalledTimes(2); // one more deletion
        await expect(
          // Ensure that 'B' is gone!
          store.get(getStoreKey(sampleManifestRecords.b.signature)),
        ).resolves.toBeUndefined();
      });

      describe('when fetching the storage secret fails', () => {
        it('will fetch the manifest using the legacy url', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash, 404);
          nockLegacyGoodManifest([
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ]);

          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');
          const agent = createAgent({ store });
          await agent.checkForUpdate();

          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);

          // Only the initial start-up check should have happened by now.
          expect(agent._timesChecked).toBe(1);
        });
      });

      describe('when fetching the manifest using the storage secret fails', () => {
        it('will fallback to fetching the manifest using the legacy url', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockStorageSecretOperationManifest(genericServiceID, genericStorageSecret, 404)
          nockLegacyGoodManifest([
            sampleManifestRecords.a,
            sampleManifestRecords.b,
            sampleManifestRecords.c,
          ]);

          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');
          const agent = createAgent({ store });
          await agent.checkForUpdate();

          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);

          // Only the initial start-up check should have happened by now.
          expect(agent._timesChecked).toBe(1);
        });
      });

      describe('When given a schemaTag', () => {
        const schemaTag = 'master';
        const getOperationManifestRelativeUrl = (
          ...args: Parameters<typeof getOperationManifestUrl>
        ) =>
          getOperationManifestUrl(...args).replace(
            new RegExp(`^${urlOperationManifestBase}`),
            '',
          );

        it('fetches manifests for the corresponding schema tag', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          const agent = createAgent({ schemaTag });
          const nockedManifest = nockBase()
            .get(
              getOperationManifestRelativeUrl(
                genericServiceID,
                genericStorageSecret,
                schemaTag,
              ),
            )
            .reply(200, manifest(sampleManifestRecords.a));
          await agent.checkForUpdate();
          expect(nockedManifest.isDone()).toBe(true);
        });
      });
    });

    describe('manifest lifecycle', () => {
      function generateWillUpdateManifest(
        operations?: OperationManifest['operations'],
      ) {
        return jest.fn(
          (
            newManifest?: OperationManifest,
            oldManifest?: OperationManifest,
          ) => {
            const manifest = newManifest || oldManifest;
            return (
              (operations && { version: 2, operations }) ||
              manifest || { version: 2, operations: [] }
            );
          },
        );
      }

      describe('willUpdateManifest', () => {
        it("receives undefined arguments when can't fetch first time", async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash, 404);
          nockBase()
            .get(genericLegacyOperationManifestUrl)
            .reply(500);
          const mock = generateWillUpdateManifest();
          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');

          const agent = createAgent({
            willUpdateManifest: mock,
            store,
          });
          await agent.start();
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(undefined, undefined);

          // no additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(0);
          expect(storeDeleteSpy).toBeCalledTimes(0);
        });
        it('receives manifest retrieved from gcs', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockGoodManifestsUnderStorageSecret(
            genericServiceID,
            genericStorageSecret,
            [
              sampleManifestRecords.a,
              sampleManifestRecords.b,
              sampleManifestRecords.c,
            ]
          );
          const mock = generateWillUpdateManifest();
          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');

          const agent = createAgent({
            willUpdateManifest: mock,
            store,
          });
          await agent.start();
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
            undefined,
          );

          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);
        });
        it('uses returned manifest to enforce safelist', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockGoodManifestsUnderStorageSecret(
            genericServiceID,
            genericStorageSecret,
            [
              sampleManifestRecords.a,
              sampleManifestRecords.b,
              sampleManifestRecords.c,
            ]
          );
          const mock = generateWillUpdateManifest([sampleManifestRecords.a]);
          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');

          const agent = createAgent({
            willUpdateManifest: mock,
            store,
          });
          await agent.start();
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
            undefined,
          );
          expect(mock).toReturnWith({
            version: 2,
            operations: [sampleManifestRecords.a],
          });

          // One additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(1);
          expect(storeDeleteSpy).toBeCalledTimes(0);
        });
        it('is not called again when manifest remains same', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockGoodManifestsUnderStorageSecret(
            genericServiceID,
            genericStorageSecret,
            [
              sampleManifestRecords.a,
              sampleManifestRecords.b,
              sampleManifestRecords.c,
            ]
          );

          const mock = generateWillUpdateManifest();
          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');

          const agent = createAgent({
            willUpdateManifest: mock,
            store,
          });
          jest.useFakeTimers();
          await agent.start();
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
            undefined,
          );
          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);

          // If it's one millisecond short of our next poll interval, nothing
          // should have changed yet.
          jest.advanceTimersByTime(defaultTestAgentPollSeconds * 1000 - 1);

          // Still only one check.
          expect(agent._timesChecked).toBe(1);

          // Now, we'll expect another request to go out, so we'll nock it.
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockBase()
            .get(genericStorageSecretOperationManifestUrl)
            .reply(304);

          // If we move forward the last remaining millisecond, we should trigger
          // and end up with a successful sync.
          jest.advanceTimersByTime(1);

          // While that timer will fire, it will do work async, and we need to
          // wait on that work itself.
          await agent.requestPending();

          // Now the times checked should have gone up.
          expect(agent._timesChecked).toBe(2);

          // the agent should not have been called again
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
            undefined,
          );
          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);
        });

        it('receives previous manifest when updated', async () => {
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockGoodManifestsUnderStorageSecret(
            genericServiceID,
            genericStorageSecret,
            [
              sampleManifestRecords.a,
              sampleManifestRecords.b,
              sampleManifestRecords.c,
            ]
          );

          const mock = generateWillUpdateManifest();
          const store = defaultStore();
          const storeSetSpy = jest.spyOn(store, 'set');
          const storeDeleteSpy = jest.spyOn(store, 'delete');

          const agent = createAgent({
            willUpdateManifest: mock,
            store,
          });
          jest.useFakeTimers();
          await agent.start();
          expect(mock).toHaveBeenCalledTimes(1);
          expect(mock).toHaveBeenCalledWith(
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
            undefined,
          );
          // Three additions, no deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(0);

          // If it's one millisecond short of our next poll interval, nothing
          // should have changed yet.
          jest.advanceTimersByTime(defaultTestAgentPollSeconds * 1000 - 1);

          // Still only one check.
          expect(agent._timesChecked).toBe(1);

          // Now, we'll expect another request to go out, so we'll nock it.
          nockStorageSecret(genericServiceID, genericApiKeyHash);
          nockGoodManifestsUnderStorageSecret(
            genericServiceID,
            genericStorageSecret,
            [sampleManifestRecords.a],
          );

          // If we move forward the last remaining millisecond, we should trigger
          // and end up with a successful sync.
          jest.advanceTimersByTime(1);

          // While that timer will fire, it will do work async, and we need to
          // wait on that work itself.
          await agent.requestPending();

          expect(mock).toHaveBeenCalledTimes(2);
          expect(mock).toHaveBeenCalledWith(
            { version: 2, operations: [sampleManifestRecords.a] },
            {
              version: 2,
              operations: [
                sampleManifestRecords.a,
                sampleManifestRecords.b,
                sampleManifestRecords.c,
              ],
            },
          );
          // Three additions, two deletions.
          expect(storeSetSpy).toBeCalledTimes(3);
          expect(storeDeleteSpy).toBeCalledTimes(2);
        });
      });
    });
  });
});