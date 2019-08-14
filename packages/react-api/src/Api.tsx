// Copyright 2017-2019 @polkadot/react-api authors & contributors
// This software may be modified and distributed under the terms
// of the Apache-2.0 license. See the LICENSE file for details.

import { ProviderInterface } from '@polkadot/rpc-provider/types';
import { ChainProperties } from '@polkadot/types/interfaces';
import { QueueTxPayloadAdd, QueueTxMessageSetStatus } from '@polkadot/react-components/Status/types';
import { Prefix } from '@polkadot/util-crypto/address/types';
import { ApiProps } from './types';

import React from 'react';
import ApiPromise from '@polkadot/api/promise';
import { isWeb3Injected, web3Accounts, web3Enable } from '@polkadot/extension-dapp';
import defaults from '@polkadot/rpc-provider/defaults';
import { InputNumber } from '@polkadot/react-components/InputNumber';
import keyring from '@polkadot/ui-keyring';
import uiSettings from '@polkadot/ui-settings';
import ApiSigner from '@polkadot/react-signer/ApiSigner';
import { Text } from '@polkadot/types';
import { formatBalance, isTestChain } from '@polkadot/util';

import WasmProviderLite from './WasmProviderLite';

import ApiContext from './ApiContext';

let api: ApiPromise;

interface Props {
  children: React.ReactNode;
  queuePayload: QueueTxPayloadAdd;
  queueSetTxStatus: QueueTxMessageSetStatus;
  url?: string;
  client: any;
}

interface State extends ApiProps {
  chain?: string | null;
}

interface InjectedAccountExt {
  address: string;
  meta: {
    name: string;
    source: string;
  };
}

export { api };

const injectedPromise = web3Enable('polkadot-js/apps');

export default class Api extends React.PureComponent<Props, State> {
  public state: State = {} as unknown as State;

  public constructor (props: Props) {
    super(props);

    let { client } = props;

    // TODO comment the following out
    client.rpcSubscribe('{"method":"chain_subscribeNewHead","params":[],"id":1,"jsonrpc":"2.0"}',
      (r: any) => console.log("[client] New chain head: " + r));
    client
      .rpcSend('{"method":"system_networkState","params":[],"id":1,"jsonrpc":"2.0"}')
      .then((r: any) => console.log("[client] Network state: " + r));

    const { queuePayload, queueSetTxStatus } = props;
    const provider = new WasmProviderLite(client)
    const signer = new ApiSigner(queuePayload, queueSetTxStatus);

    const setApiUrl = (url: string = defaults.WS_URL): void => {
      console.warn('Api change ignored');
    }

    api = new ApiPromise({ provider, signer });

    this.state = {
      api,
      isApiConnected: false,
      isApiReady: false,
      isSubstrateV2: true,
      isWaitingInjected: isWeb3Injected,
      setApiUrl
    } as unknown as State;
  }

  public componentDidMount (): void {
    this.subscribeEvents();

    injectedPromise
      .then((): void => this.setState({ isWaitingInjected: false }))
      .catch(console.error);
  }

  private subscribeEvents (): void {
    const { api } = this.state;

    api.on('connected', (): void => {
      console.log('*** API IS CONNECTED !');
      this.setState({ isApiConnected: true });
    });

    api.on('disconnected', (): void => {
      console.log('*** API IS DISCONNECTED !');
      this.setState({ isApiConnected: false });
    });

    api.on('ready', async (): Promise<void> => {
      console.log('*** API IS READY!');
      try {
        await this.loadOnReady(api);
      } catch (error) {
        console.error('Unable to load chain', error);
      }
    });
  }

  private async loadOnReady (api: ApiPromise): Promise<void> {
    const [properties, value, injectedAccounts] = await Promise.all([
      api.rpc.system.properties<ChainProperties>(),
      api.rpc.system.chain<Text>(),
      web3Accounts().then((accounts): InjectedAccountExt[] =>
        accounts.map(({ address, meta }): InjectedAccountExt => ({
          address,
          meta: {
            ...meta,
            name: `${meta.name} (${meta.source === 'polkadot-js' ? 'extension' : meta.source})`
          }
        }))
      )
    ]);
    const addressPrefix = (
      uiSettings.prefix === -1
        ? 42
        : uiSettings.prefix
    ) as Prefix;
    const tokenSymbol = properties.tokenSymbol.toString() || 'DEV';
    const tokenDecimals = properties.tokenDecimals.toNumber() || 15;
    const chain = value
      ? value.toString()
      : null;
    const isDevelopment = isTestChain(chain);

    console.log('api: found chain', chain, JSON.stringify(properties));

    // first setup the UI helpers
    formatBalance.setDefaults({
      decimals: tokenDecimals,
      unit: tokenSymbol
    });
    InputNumber.setUnit(tokenSymbol);

    // finally load the keyring
    keyring.loadAll({
      addressPrefix,
      genesisHash: api.genesisHash,
      isDevelopment,
      type: 'ed25519'
    }, injectedAccounts);

    const defaultSection = Object.keys(api.tx)[0];
    const defaultMethod = Object.keys(api.tx[defaultSection])[0];
    const apiDefaultTx = api.tx[defaultSection][defaultMethod];
    const apiDefaultTxSudo =
      (api.tx.system && api.tx.system.setCode) || // 2.x
      (api.tx.consensus && api.tx.consensus.setCode) || // 1.x
      apiDefaultTx; // other
    const isSubstrateV2 = !!Object.keys(api.consts).length;

    this.setState({
      apiDefaultTx,
      apiDefaultTxSudo,
      chain,
      isApiReady: true,
      isDevelopment,
      isSubstrateV2
    });
  }

  public render (): React.ReactNode {
    const { api, apiDefaultTx, apiDefaultTxSudo, chain, isApiConnected, isApiReady, isDevelopment, isSubstrateV2, isWaitingInjected, setApiUrl } = this.state;

    return (
      <ApiContext.Provider
        value={{
          api,
          apiDefaultTx,
          apiDefaultTxSudo,
          currentChain: chain || '<unknown>',
          isApiConnected,
          isApiReady: isApiReady && !!chain,
          isDevelopment,
          isSubstrateV2,
          isWaitingInjected,
          setApiUrl
        }}
      >
        {this.props.children}
      </ApiContext.Provider>
    );
  }
}
