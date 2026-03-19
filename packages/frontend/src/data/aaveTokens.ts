import type { Address } from "viem"

export interface AaveTokenEntry {
  aToken?: Address
  vToken?: Address
}

// Protocol -> ChainId -> UnderlyingAddress -> { aToken, vToken }
export const AAVE_TOKENS: Record<string, Record<string, Record<Address, AaveTokenEntry>>> = {
  "AAVE_V2": {
    "1": {
      "0x0000000000085d4780b73119b644ae5ecd22b376": {
        "aToken": "0x101cc05f4a51c0319f570d5e146a8c625198e636",
        "vToken": "0x01c0eb1f8c6f1c1bf74ae028697ce7aa2a8b0e92"
      },
      "0x03ab458634910aad20ef5f1c8ee96f1d6ac54919": {
        "aToken": "0xc9bc48c72154ef3e5425641a3c747242112a46af",
        "vToken": "0xb5385132ee8321977fff44b60cde9fe9ab0b4e6b"
      },
      "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd": {
        "aToken": "0xd37ee7e4f452c6638c96536e68090de8cbcdb583",
        "vToken": "0x279af5b99540c1a3a7e3cdd326e19659401ef99e"
      },
      "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e": {
        "aToken": "0x5165d24277cd063f5ac44efd447b27025e888f37",
        "vToken": "0x7ebd09022be45ad993baa1cec61166fcc8644d97"
      },
      "0x0d8775f648430679a709e98d2b0cb6250d2887ef": {
        "aToken": "0x05ec93c0365baaeabf7aeffb0972ea7ecdd39cf1",
        "vToken": "0xfc218a6dfe6901cb34b1a5281fc6f1b8e7e56877"
      },
      "0x0f5d2fb29fb7d3cfee444a200298f468908cc942": {
        "aToken": "0xa685a61171bb30d4072b338c80cb7b2c865c873e",
        "vToken": "0x0a68976301e46ca6ce7410db28883e309ea0d352"
      },
      "0x111111111117dc0aa78b770fa6a738034120c302": {
        "aToken": "0xb29130cbcc3f791f077eade0266168e808e5151e",
        "vToken": "0xd7896c1b9b4455aff31473908eb15796ad2295da"
      },
      "0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b": {
        "aToken": "0x6f634c6135d2ebd550000ac92f494f9cb8183dae",
        "vToken": "0x4ddff5885a67e4effec55875a3977d7e60f82ae0"
      },
      "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
        "aToken": "0xb9d7cb55f463405cdfbe4e90a6d2df01c2b92bf1",
        "vToken": "0x5bdb050a92cadccfcdcccbfc17204a1c9cc0ab73"
      },
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0x9ff58f4ffb29fa2266ab25e75e2a8b3503311656",
        "vToken": "0x9c39809dec7f95f5e0713634a4d0701329b3b4d2"
      },
      "0x408e41876cccdc0f92210600ef50372656052a38": {
        "aToken": "0xcc12abe4ff81c9378d670de1b57f8e0dd228d77a",
        "vToken": "0xcd9d82d33bd737de215cdac57fe2f7f04df77fe0"
      },
      "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b": {
        "aToken": "0x952749e07d7157bb9644a894dfaf3bad5ef6d918",
        "vToken": "0x4ae5e4409c6dbc84a00f9f89e4ba096603fb7d50"
      },
      "0x4fabb145d64652a948d72533023f6e7a623c7c53": {
        "aToken": "0xa361718326c15715591c299427c62086f69923d9",
        "vToken": "0xba429f7011c9fa04cdd46a2da24dc0ff0ac6099c"
      },
      "0x514910771af9ca656af840dff83e8264ecf986ca": {
        "aToken": "0xa06bc25b5805d5f8d82847d191cb4af5a3e873e0",
        "vToken": "0x0b8f12b1788bfde65aa1ca52e3e9f3ba401be16d"
      },
      "0x57ab1ec28d129707052df4df418d58a2d46d5f51": {
        "aToken": "0x6c5024cd4f8a59110119c56f8933403a539555eb",
        "vToken": "0xdc6a3ab17299d9c2a412b0e0a4c1f55446ae0817"
      },
      "0x5f98805a4e8be255a32880fdec7f6728c6568ba0": {
        "aToken": "0xce1871f791548600cb59efbeffc9c38719142079",
        "vToken": "0x411066489ab40442d6fc215ad7c64224120d33f2"
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "aToken": "0x028171bca77440897b824ca71d1c56cac55b68a3",
        "vToken": "0x6c3c78838c761c6ac7be9f59fe808ea2a6e4379d"
      },
      "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
        "aToken": "0xffc97d72e13e01096502cb8eb52dee56f74dad7b",
        "vToken": "0xf7dba49d571745d9d7fcb56225b05bea803ebf3c"
      },
      "0x853d955acef822db058eb8505911ed77f175b99e": {
        "aToken": "0xd4937682df3c8aef4fe912a96a74121c0829e664",
        "vToken": "0xfe8f19b17ffef0fdbfe2671f248903055afaa8ca"
      },
      "0x8798249c2e607446efb7ad49ec89dd1865ff4272": {
        "aToken": "0xf256cc7847e919fac9b808cc216cac87ccf2f47a",
        "vToken": "0xfafedf95e21184e3d880bd56d4806c4b8d31c69a"
      },
      "0x8e870d67f660d95d5be530380d0ec0bd388289e1": {
        "aToken": "0x2e8f4bdbe3d47d7d7de490437aea9915d930f1a3",
        "vToken": "0xfdb93b3b10936cf81fa59a02a7523b6e2149b2b7"
      },
      "0x956f47f50a910163d8bf957cf5846d573e7f87ca": {
        "aToken": "0x683923db55fead99a79fa01a27eec3cb19679cc3",
        "vToken": "0xc2e10006accab7b45d9184fcf5b7ec7763f5baae"
      },
      "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2": {
        "aToken": "0xc713e5e149d5d0715dcd1c156a020976e7e56b88",
        "vToken": "0xba728ead5e496be00dcf66f650b6d7758ecb50f8"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0xbcca60bb61934080951369a648fb03df4f96263c",
        "vToken": "0x619beb58998ed2278e08620f97007e1116d5d25b"
      },
      "0xa693b19d2931d498c5b318df961919bb4aee87a5": {
        "aToken": "0xc2e2152647f4c26028482efaf64b2aa28779efc4",
        "vToken": "0xaf32001cf2e66c4c3af4205f6ea77112aa4160fe"
      },
      "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": {
        "aToken": "0x1982b2f5814301d4e9a8b0201555376e62f82428",
        "vToken": "0xa9deac9f00dc4310c35603fcd9d34d1a750f81db"
      },
      "0xba100000625a3754423978a60c9317c58a424e3d": {
        "aToken": "0x272f97b7a56a387ae942350bbc7df5700f8a4576",
        "vToken": "0x13210d4fe0d5402bd7ecbc4b5bc5cfca3b71adb0"
      },
      "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f": {
        "aToken": "0x35f6b052c598d933d69a4eec4d04c73a191fe6c2",
        "vToken": "0x267eb8cf715455517f9bd5834aeae3cea1ebdbd8"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0x030ba81f1c18d280636f32af80b9aad02cf0854e",
        "vToken": "0xf63b34710400cad3e044cffdcab00a0f32e33ecf"
      },
      "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72": {
        "aToken": "0x9a14e23a58edf4efdcb360f68cd1b95ce2081a2f",
        "vToken": "0x176808047cc9b7a2c9ae202c593ed42ddd7c0d13"
      },
      "0xd46ba6d942050d489dbd938a2c909a5d5039a161": {
        "aToken": "0x1e6bb68acec8fefbd87d192be09bb274170a0548",
        "vToken": "0xf013d90e4e4e3baf420dfea60735e75dbd42f1e1"
      },
      "0xd5147bc8e386d91cc5dbe72099dac6c9b99276f5": {
        "aToken": "0x514cd6756ccbe28772d4cb81bc3156ba9d1744aa",
        "vToken": "0x348e2ebd5e962854871874e444f4122399c02755"
      },
      "0xd533a949740bb3306d119cc777fa900ba034cd52": {
        "aToken": "0x8dae6cb04688c62d939ed9b68d32bc62e49970b1",
        "vToken": "0x00ad8ebf64f141f1c81e9f8f792d3d1631c6c684"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0x3ed3b47dd13ec9a98b44e6204a523e766b225811",
        "vToken": "0x531842cebbdd378f8ee36d171d6cc9c4fcf475ec"
      },
      "0xdd974d5c2e2928dea5f71b9825b8b646686bd200": {
        "aToken": "0x39c6b3e42d6a679d7d776778fe880bc9487c2eda",
        "vToken": "0x6b05d1c608015ccb8e205a690cb86773a96f39f1"
      },
      "0xe41d2489571d322189246dafa5ebde1f4699f498": {
        "aToken": "0xdf7ff54aacacbff42dfe29dd6144a69b629f8c9e",
        "vToken": "0x85791d117a392097590bded3bd5abb8d5a20491a"
      },
      "0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c": {
        "aToken": "0xac6df26a590f08dcc95d5a4705ae8abbc88509ef",
        "vToken": "0x38995f292a6e31b78203254fe1cdd5ca1010a446"
      }
    },
    "137": {
      "0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a": {
        "aToken": "0x21ec9431b5b55c5339eb1ae7582763087f98fac2",
        "vToken": "0x9cb9feafa73bf392c905eebf5669ad3d073c3dfc"
      },
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": {
        "aToken": "0x8df3aad3a84da6b69a4da8aec3ea40d9091b2ac4",
        "vToken": "0x59e8e9100cbfcbcbadf86b9279fa61526bbb8765"
      },
      "0x172370d5cd63279efa6d502dab29171933a610af": {
        "aToken": "0x3df8f92b7e798820ddcca2ebea7babda2c90c4ad",
        "vToken": "0x780bbcbcda2cdb0d2c61fd9bc68c9046b18f3229"
      },
      "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": {
        "aToken": "0x5c2ed810328349100a66b82b78a1791b101c9d61",
        "vToken": "0xf664f50631a6f0d72ecdaa0e49b0c019fa72a8dc"
      },
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": {
        "aToken": "0x1a13f4ca1d028320a707d99520abfefca3998b7f",
        "vToken": "0x248960a9d75edfa3de94f7193eae3161eb349a12"
      },
      "0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7": {
        "aToken": "0x080b5bf8f360f624628e0fb961f4e67c9e3c7cf1",
        "vToken": "0x36e988a38542c3482013bb54ee46ac1fb1efedcd"
      },
      "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39": {
        "aToken": "0x0ca2e42e8c21954af73bc9af1213e4e81d6a669a",
        "vToken": "0xcc71e4a38c974e19bdbc6c0c19b63b8520b1bb09"
      },
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": {
        "aToken": "0x28424507fefb6f7f8e9d3860f56504e4e5f5f390",
        "vToken": "0xede17e9d79fc6f9ff9250d9eefbdb88cc18038b5"
      },
      "0x85955046df4668e1dd369d2de9f3aeb98dd2a369": {
        "aToken": "0x81fb82aacb4abe262fc57f06fd4c1d2de347d7b1",
        "vToken": "0x43150aa0b7e19293d935a412c8607f9172d3d3f3"
      },
      "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": {
        "aToken": "0x27f8d03b3a2196956ed754badc28d73be8830a6e",
        "vToken": "0x75c4d1fb84429023170086f06e682dcbbf537b7d"
      },
      "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": {
        "aToken": "0xc4195d4060daeac44058ed668aa5efec50d77ff6",
        "vToken": "0x773e0e32e7b6a00b7ca9daa85dfba9d61b7f2574"
      },
      "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": {
        "aToken": "0x60d55f02a771d515e077c9c2403a1ef324885cec",
        "vToken": "0x8038857fd47108a07d1f6bf652ef1cbec279a2f3"
      },
      "0xd6df932a45c0f255f85145f286ea0b292b21c90b": {
        "aToken": "0x1d2a0e5ec8e5bbdca5cb219e649b565d8e5c3360",
        "vToken": "0x1c313e9d0d826662f5ce692134d938656f681350"
      }
    }
  },
  "AAVE_V3": {
    "1": {
      "0x111111111117dc0aa78b770fa6a738034120c302": {
        "aToken": "0x71aef7b30728b9bb371578f36c5a1f1502a5723e",
        "vToken": "0xa38fca8c6bf9bda52e76eb78f08caa3be7c5a970"
      },
      "0x14bdc3a3ae09f5518b923b69489cbcafb238e617": {
        "aToken": "0x2edff5af94334fbd7c38ae318edf1c40e072b73b",
        "vToken": "0x22517fe16ded08e52e7ea3423a2ea4995b1f1731"
      },
      "0x18084fba666a33d37592fa2633fd49a74dd93a88": {
        "aToken": "0x10ac93971cdb1f5c778144084242374473c350da",
        "vToken": "0xac50890a80a2731eb1ea2e9b4f29569ceb06d960"
      },
      "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c": {
        "aToken": "0xaa6e91c82942aeae040303bf96c15a6dbcb82ca0",
        "vToken": "0x6c82c66622eb360fc973d3f492f9d8e9ea538b08"
      },
      "0x1f84a51296691320478c98b8d77f2bbd17d34350": {
        "aToken": "0xe728577e9a1fe7032bc309b4541f58f45443866e",
        "vToken": "0x9d244a99801dc05cbc04183769c17056b8a1ad53"
      },
      "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
        "aToken": "0xf6d2224916ddfbbab6e6bd0d1b7034f4ae0cab18",
        "vToken": "0xf64178ebd2e2719f2b1233bcb5ef6db4bcc4d09a"
      },
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0x5ee5bf7ae06d1be5997a1a72006fe6c607ec6de8",
        "vToken": "0x40aabef1aa8f0eec637e0e7d92fbffb2f26a8b7b"
      },
      "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0": {
        "aToken": "0x82f9c5ad306bba1ad0de49bb5fa6f01bf61085ef",
        "vToken": "0x68e9f0ad4e6f8f5db70f6923d4d6d5b225b83b16"
      },
      "0x356b8d89c1e1239cbbb9de4815c39a1474d5ba7d": {
        "aToken": "0x24ab03a9a5bc2c49e5523e8d915a3536ac38b91d",
        "vToken": "0xaef73b04654931b94920a3d7ae62032b79fb6d0c"
      },
      "0x3b3fb9c57858ef816833dc91565efcd85d96f634": {
        "aToken": "0xde6ef6cb4abd3a473ffc2942eef5d84536f8e864",
        "vToken": "0x8c6feaf5d58ba1a6541f9c4af685f62bfcbac3b1"
      },
      "0x3de0ff76e8b528c092d47b9dac775931cef80f49": {
        "aToken": "0x81b76ff3fed28ba0b4a5d4c76bd5c13bd0641d86",
        "vToken": "0x762edb8d79b97487f82093f85059e42eeef61e9e"
      },
      "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f": {
        "aToken": "0x00907f9921424583e7ffbfedf84f92b7b2be4977",
        "vToken": "0x786dbff3f1292ae8f92ea68cf93c30b34b1ed04b"
      },
      "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": {
        "aToken": "0x4f5923fc5fd4a93352581b38b7cd26943012decf",
        "vToken": "0x015396e1f286289ae23a762088e863b3ec465145"
      },
      "0x50d2c7992b802eef16c04feadab310f31866a545": {
        "aToken": "0x4b0821e768ed9039a70ed1e80e15e76a5be5df5f",
        "vToken": "0x3c20fbfd32243dd9899301c84bce17413eee0a0c"
      },
      "0x514910771af9ca656af840dff83e8264ecf986ca": {
        "aToken": "0x5e8c8a7243651db1384c0ddfdbe39761e8e7e51a",
        "vToken": "0x4228f8895c7dda20227f6a5c6751b8ebf19a6ba8"
      },
      "0x5a98fcbea516cf06857215779fd812ca3bef1b32": {
        "aToken": "0x9a44fd41566876a39655f74971a3a6ea0a17a454",
        "vToken": "0xc30808705c01289a3d306ca9cab081ba9114ec82"
      },
      "0x5f98805a4e8be255a32880fdec7f6728c6568ba0": {
        "aToken": "0x3fe6a295459fae07df8a0cecc36f37160fe86aa9",
        "vToken": "0x33652e48e4b74d18520f11bfe58edd2ed2cec5a2"
      },
      "0x62c6e813b9589c3631ba0cdb013acdb8544038b7": {
        "aToken": "0x38c503a438185cde29b5cf4dc1442fd6f074f1cc",
        "vToken": "0x2ce7e7b238985a8ad3863de03f200b245b0c1216"
      },
      "0x657e8c867d8b37dcc18fa4caead9c45eb088c642": {
        "aToken": "0x5fefd7069a7d91d01f269dade14526ccf3487810",
        "vToken": "0x47ed0509e64615c0d5c6d39af1b38d02bc9fe58f"
      },
      "0x68749665ff8d2d112fa859aa293f07a622782f38": {
        "aToken": "0x8a2b6f94ff3a89a03e8c02ee92b55af90c9454a2",
        "vToken": "0xa665bb258d2a732c170dfd505924214c0b1ac74f"
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "aToken": "0x018008bfb33d285247a21d44e50697654f754e63",
        "vToken": "0xcf8d0c70c850859266f5c338b38f9d663181c314"
      },
      "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
        "aToken": "0x0c0d01abf3e6adfca0989ebba9d6e85dd58eab1e",
        "vToken": "0x57b67e4de077085fd0af2174e9c14871be664546"
      },
      "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
        "aToken": "0x0b925ed163218f6662a35e0f0371ac234f9e9371",
        "vToken": "0xc96113eed8cab59cd8a66813bcb0ceb29f06d2e4"
      },
      "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
        "aToken": "0xa700b4eb416be35b2911fd5dee80678ff64ff6c9",
        "vToken": "0xbae535520abd9f8c85e58929e0006a2c8b372f74"
      },
      "0x8236a87084f8b84306f72007f36f2618a5634494": {
        "aToken": "0x65906988adee75306021c417a1a3458040239602",
        "vToken": "0x68aeb290c7727d899b47c56d1c96aeac475cd0dd"
      },
      "0x8292bb45bf1ee4d140127049757c2e0ff06317ed": {
        "aToken": "0xfa82580c16a31d0c1bc632a36f82e83efef3eec0",
        "vToken": "0xbdfe7ad7976d5d7e0965ea83a81ca1bcff7e84a9"
      },
      "0x83f20f44975d03b1b09e64809b757c47f942beea": {
        "aToken": "0x4c612e3b15b96ff9a6faed838f8d07d479a8dd4c",
        "vToken": "0x8db9d35e117d8b93c6ca9b644b25bad5d9908141"
      },
      "0x853d955acef822db058eb8505911ed77f175b99e": {
        "aToken": "0xd4e245848d6e1220dbe62e155d89fa327e43cb06",
        "vToken": "0x88b8358f5bc87c2d7e116cca5b65a9eeb2c5ea3f"
      },
      "0x90d2af7d622ca3141efa4d8f1f24d86e5974cc8f": {
        "aToken": "0x5f9190496e0dfc831c3bd307978de4a245e2f5cd",
        "vToken": "0x48351fcc9536da440ae9471220f6dc921b0eb703"
      },
      "0x917459337caac939d41d7493b3999f571d20d667": {
        "aToken": "0x312ffc57778cefa11989733e6e08143e7e229c1c",
        "vToken": "0xd90da2df915b87fe1621a7f2201fbf4ff2cca031"
      },
      "0x9bf45ab47747f4b4dd09b3c2c73953484b4eb375": {
        "aToken": "0x1241ec22c9bdf16ba1eb636f2a8de7e28a4343cf",
        "vToken": "0xacd3d3facea0424984f662827b988f4581a3ce31"
      },
      "0x9d39a5de30e57443bff2a8307a4256c8797a3497": {
        "aToken": "0x4579a27af00a62c0eb156349f31b345c08386419",
        "vToken": "0xeffde9bfa8ec77c14c364055a200746d6e12bed6"
      },
      "0x9f56094c450763769ba0ea9fe2876070c0fd5f77": {
        "aToken": "0x5f4a0873a3a02f7c0cb0e13a1d4362a1ad90e751",
        "vToken": "0xc9ad8dd111e6384128146467aaf92b81ec422848"
      },
      "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2": {
        "aToken": "0x8a458a9dc9048e005d22849f470891b840296619",
        "vToken": "0x6efc73e54e41b27d2134ff9f98f15550f30df9b1"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c",
        "vToken": "0x72e95b8931767c79ba4eee721354d6e99a61d004"
      },
      "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7": {
        "aToken": "0x2d62109243b87c4ba3ee7ba1d91b0dd0a074d7b1",
        "vToken": "0x6de3e52a1b7294a34e271a508082b1ff4a37e30e"
      },
      "0xa35b1b31ce002fbf2058d22f30f95d405200a15b": {
        "aToken": "0x1c0e06a0b1a4c160c17545ff2a951bfca57c0002",
        "vToken": "0x08a8dc81aea67f84745623ac6c72cda3967aab8b"
      },
      "0xaca92e438df0b2401ff60da7e4337b687a2435da": {
        "aToken": "0xaa0200d169ff3ba9385c12e073c5d1d30434ae7b",
        "vToken": "0xe35e6a0d3abc28289f5d4c2d262a133df936b98d"
      },
      "0xae78736cd615f374d3085123a210448e74fc6393": {
        "aToken": "0xcc9ee9483f662091a1de4795249e24ac0ac2630f",
        "vToken": "0xae8593dd575fe29a9745056aa91c4b746eee62c8"
      },
      "0xaebf0bb9f57e89260d57f31af34eb58657d96ce0": {
        "aToken": "0xe036478da9a7ed89b56fe39a06e1fc1a4b38d4ea",
        "vToken": "0x04142fc546d59838852873bba5c8827601a13fc8"
      },
      "0xaf5191b0de278c7286d6c7cc6ab6bb8a73ba2cd6": {
        "aToken": "0x1ba9843bd4327c6c77011406de5fa8749f7e3479",
        "vToken": "0x655568bdd6168325ec7e58bf39b21a856f906dc2"
      },
      "0xba100000625a3754423978a60c9317c58a424e3d": {
        "aToken": "0x2516e7b3f76294e03c42aa4c5b5b4dce9c436fb8",
        "vToken": "0x3d3efceb4ff0966d34d9545d3a2fa2dcdbf451f2"
      },
      "0xbc6736d346a5ebc0debc997397912cd9b8fae10a": {
        "aToken": "0x38a5357ce55c81add62abc84fb32981e2626adef",
        "vToken": "0x0d8486e1cabf3c9407b3dda0cfc4d9c3101fb683"
      },
      "0xbe9895146f7af43049ca1c1ae358b0541ea49704": {
        "aToken": "0x977b6fc5de62598b08c85ac8cf2b745874e8b78c",
        "vToken": "0x0c91bca95b5fe69164ce583a2ec9429a569798ed"
      },
      "0xbf5495efe5db9ce00f80364c8b423567e58d2110": {
        "aToken": "0x4e2a4d9b3df7aae73b418bd39f3af9e148e3f479",
        "vToken": "0x730318db7b830d324fc3feddb1d212ec64bd3141"
      },
      "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f": {
        "aToken": "0xc7b4c17861357b8abb91f25581e7263e08dcb59c",
        "vToken": "0x8d0de040e8aad872ec3c33a3776de9152d3c34ca"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8",
        "vToken": "0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe"
      },
      "0xc139190f447e929f090edeb554d95abb8b18ac1c": {
        "aToken": "0xec4ef66d4fceeba34abb4de69db391bc5476ccc8",
        "vToken": "0xea85a065f87fe28aa8fbf0d6c7dec472b106252c"
      },
      "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72": {
        "aToken": "0x545bd6c032efdde65a377a6719def2796c8e0f2e",
        "vToken": "0xd180d7fdd4092f07428efe801e17bc03576b3192"
      },
      "0xc96de26018a54d51c097160568752c4e3bd6c364": {
        "aToken": "0xcca43cef272c30415866914351fdfc3e881bb7c2",
        "vToken": "0x4a35fd7f93324cc48bc12190d3f37493437b1eff"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0x5c647ce0ae10658ec44fa4e11a51c96e94efd1dd",
        "vToken": "0xeb284a70557efe3591b9e6d9d720040e02c54a4d"
      },
      "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": {
        "aToken": "0xbdfa7b7893081b35fb54027489e2bc7a38275129",
        "vToken": "0x77ad9bf13a52517ad698d65913e8d381300c8bf3"
      },
      "0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8": {
        "aToken": "0x481a2acf3a72ffdc602a9541896ca1db87f86cf7",
        "vToken": "0x7ec9afe70f8fd603282ebacbc9058a83623e2899"
      },
      "0xd33526068d116ce69f19a9ee46f0bd304f21a51f": {
        "aToken": "0xb76cf92076adbf1d9c39294fa8e7a67579fde357",
        "vToken": "0x8988eca19d502fd8b9ccd03fa3bd20a6f599bc2a"
      },
      "0xd533a949740bb3306d119cc777fa900ba034cd52": {
        "aToken": "0x7b95ec873268a6bfc6427e7a28e396db9d0ebc65",
        "vToken": "0x1b7d3f4b3c032a5ae656e30eea4e8e1ba376068f"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0x23878914efe38d27c4d67ab83ed1b93a74d4086a",
        "vToken": "0x6df1c1e379bc5a00a7b4c6e67a203333772f45a8"
      },
      "0xdc035d45d973e3ec169d2276ddab16f1e407384f": {
        "aToken": "0x32a6268f9ba3642dda7892add74f1d34469a4259",
        "vToken": "0x490e0e6255bf65b43e2e02f7acb783c5e04572ff"
      },
      "0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202": {
        "aToken": "0x5b502e3796385e1e9755d7043b9c945c3accec9c",
        "vToken": "0x253127ffc04981cea8932f406710661c2f2c3fd2"
      },
      "0xe343167631d89b6ffc58b88d6b7fb0228795491d": {
        "aToken": "0x7c0477d085ecb607cf8429f3ec91ae5e1e460f4f",
        "vToken": "0x4f97b950a30321c181e974971e156e19fad184a3"
      },
      "0xe6a934089bbee34f832060ce98848359883749b3": {
        "aToken": "0x285866acb0d60105b4ed350a463361c2d9afa0e2",
        "vToken": "0x690df181701c11c53ea33bbf303c25834b66bd14"
      },
      "0xe8483517077afa11a9b07f849cee2552f040d7b2": {
        "aToken": "0xbe54767735fb7acca2aa7e2d209a6f705073536d",
        "vToken": "0xa803414f84fcef00e745be7cc2a315908927f15d"
      },
      "0xf1c9acdc66974dfb6decb12aa385b9cd01190e38": {
        "aToken": "0x927709711794f3de5ddbf1d176bee2d55ba13c21",
        "vToken": "0x8838eeff2af391863e1bb8b1df563f86743a8470"
      },
      "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e": {
        "aToken": "0xb82fa9f31612989525992fcfbb09ab22eff5c85a",
        "vToken": "0x028f7886f3e937f8479efad64f31b3fe1119857a"
      }
    },
    "10": {
      "0x0b2c639c533813f4aa9d7837caf62653d097ff85": {
        "aToken": "0x38d693ce1df5aadf7bc62595a37d667ad57922e5",
        "vToken": "0x5d557b07776d12967914379c71a1310e917c7555"
      },
      "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb": {
        "aToken": "0xc45a479877e1e9dfe9fcd4056c699575a1045daa",
        "vToken": "0x34e2ed44ef7466d5f9e0b782b5c08b57475e7907"
      },
      "0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6": {
        "aToken": "0x191c10aa4af7c30e871e70c95db0e4eb77237530",
        "vToken": "0x953a573793604af8d41f306feb8274190db4ae0e"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8",
        "vToken": "0x0c84331e39d6658cd6e6b9ba04736cc4c4734351"
      },
      "0x4200000000000000000000000000000000000042": {
        "aToken": "0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff",
        "vToken": "0x77ca01483f379e58174739308945f044e1a764dc"
      },
      "0x68f180fcce6836688e9084f035309e29bf0a2095": {
        "aToken": "0x078f358208685046a11c85e8ad32895ded33a249",
        "vToken": "0x92b42c66840c7ad907b4bf74879ff3ef7c529473"
      },
      "0x76fb31fb4af56892a25e32cfc43de717950c9278": {
        "aToken": "0xf329e36c7bf6e5e86ce2150875a84ce77f477375",
        "vToken": "0xe80761ea617f66f96274ea5e8c37f03960ecc679"
      },
      "0x7f5c764cbc14f9669b88837ca1490cca17c31607": {
        "aToken": "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
        "vToken": "0xfccf3cabbe80101232d343252614b6a3ee81c989"
      },
      "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9": {
        "aToken": "0x6d80113e533a2c0fe82eabd35f1875dcea89ea97",
        "vToken": "0x4a1c3ad6ed28a636ee1751c69071f6be75deb8b8"
      },
      "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": {
        "aToken": "0x6ab707aca953edaefbc4fd23ba73294241490620",
        "vToken": "0xfb00ac187a8eb5afae4eace434f493eb62672df7"
      },
      "0x9bcef72be871e61ed4fbbc7630889bee758eb81d": {
        "aToken": "0x724dc807b04555b71ed48a6896b6f41593b8c637",
        "vToken": "0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6"
      },
      "0xc40f949f8a4e094d1b49a23ea9241d289b7b2819": {
        "aToken": "0x8eb270e296023e9d92081fdf967ddd7878724424",
        "vToken": "0xce186f6cccb0c955445bb9d10c59cae488fea559"
      },
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
        "aToken": "0x82e64f49ed5ec1bc6e43dad4fc8af9bb3a2312ee",
        "vToken": "0x8619d80fb0141ba7f184cbf22fd724116d9f7ffc"
      },
      "0xdfa46478f9e5ea86d57387849598dbfb2e964b02": {
        "aToken": "0x8ffdf2de812095b1d19cb146e4c004587c0a0692",
        "vToken": "0xa8669021776bc142dfca87c21b4a52595bcbb40a"
      }
    },
    "56": {
      "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": {
        "aToken": "0x4199cc1f5ed0d796563d7ccb2e036253e2c18281",
        "vToken": "0xe20dbc7119c635b1b51462f844861258770e0699"
      },
      "0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
        "aToken": "0x2e94171493fabe316b6205f1585779c887771e2f",
        "vToken": "0x8fdea7891b4d6dbdc746309245b316af691a636c"
      },
      "0x26c5e01524d2e6280a48f2c50ff6de7e52e9611c": {
        "aToken": "0xbdfd4e51d3c14a232135f04988a42576efb31519",
        "vToken": "0x2c391998308c56d7572a8f501d58cb56fb9fe1c5"
      },
      "0x55d398326f99059ff775485246999027b3197955": {
        "aToken": "0xa9251ca9de909cb71783723713b21e4233fbf1b1",
        "vToken": "0xf8bb2be50647447fb355e3a77b81be4db64107cd"
      },
      "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": {
        "aToken": "0x56a7ddc4e848ebf43845854205ad71d5d5f72d3d",
        "vToken": "0x7b1e82f4f542fbb25d64c5523fe3e44abe4f2702"
      },
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
        "aToken": "0x00901a076785e0906d1028c7d6372d247bec7d61",
        "vToken": "0xcdbbed5606d9c5c98eeedd67933991dc17f0c68d"
      },
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": {
        "aToken": "0x9b00a09492a626678e5a3009982191586c444df9",
        "vToken": "0x0e76414d433ddfe8004d2a7505d218874875a996"
      },
      "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": {
        "aToken": "0x75bd1a659bdc62e4c313950d44a2416fab43e785",
        "vToken": "0xe628b8a123e6037f1542e662b9f55141a16945c8"
      }
    },
    "137": {
      "0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd": {
        "aToken": "0xf59036caebea7dc4b86638dfa2e3c97da9fccd40",
        "vToken": "0x77fa66882a8854d883101fb8501bd3cad347fc32"
      },
      "0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a": {
        "aToken": "0xc45a479877e1e9dfe9fcd4056c699575a1045daa",
        "vToken": "0x34e2ed44ef7466d5f9e0b782b5c08b57475e7907"
      },
      "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270": {
        "aToken": "0x6d80113e533a2c0fe82eabd35f1875dcea89ea97",
        "vToken": "0x4a1c3ad6ed28a636ee1751c69071f6be75deb8b8"
      },
      "0x172370d5cd63279efa6d502dab29171933a610af": {
        "aToken": "0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff",
        "vToken": "0x77ca01483f379e58174739308945f044e1a764dc"
      },
      "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6": {
        "aToken": "0x078f358208685046a11c85e8ad32895ded33a249",
        "vToken": "0x92b42c66840c7ad907b4bf74879ff3ef7c529473"
      },
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174": {
        "aToken": "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
        "vToken": "0xfccf3cabbe80101232d343252614b6a3ee81c989"
      },
      "0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7": {
        "aToken": "0x8eb270e296023e9d92081fdf967ddd7878724424",
        "vToken": "0xce186f6cccb0c955445bb9d10c59cae488fea559"
      },
      "0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4": {
        "aToken": "0xea1132120ddcdda2f119e99fa7a27a0d036f7ac9",
        "vToken": "0x6b030ff3fb9956b1b69f475b77ae0d3cf2cc5afa"
      },
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": {
        "aToken": "0xa4d94019934d8333ef880abffbf2fdd611c762bd",
        "vToken": "0xe701126012ec0290822eea17b794454d1af8b030"
      },
      "0x4e3decbb3645551b8a19f0ea1678079fcb33fb4c": {
        "aToken": "0x6533afac2e7bccb20dca161449a13a32d391fb00",
        "vToken": "0x44705f578135cc5d703b4c9c122528c73eb87145"
      },
      "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39": {
        "aToken": "0x191c10aa4af7c30e871e70c95db0e4eb77237530",
        "vToken": "0x953a573793604af8d41f306feb8274190db4ae0e"
      },
      "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": {
        "aToken": "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8",
        "vToken": "0x0c84331e39d6658cd6e6b9ba04736cc4c4734351"
      },
      "0x85955046df4668e1dd369d2de9f3aeb98dd2a369": {
        "aToken": "0x724dc807b04555b71ed48a6896b6f41593b8c637",
        "vToken": "0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6"
      },
      "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": {
        "aToken": "0x82e64f49ed5ec1bc6e43dad4fc8af9bb3a2312ee",
        "vToken": "0x8619d80fb0141ba7f184cbf22fd724116d9f7ffc"
      },
      "0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3": {
        "aToken": "0x8ffdf2de812095b1d19cb146e4c004587c0a0692",
        "vToken": "0xa8669021776bc142dfca87c21b4a52595bcbb40a"
      },
      "0xa3fa99a148fa48d14ed51d610c367c61876997f1": {
        "aToken": "0xebe517846d0f36eced99c735cbf6131e1feb775d",
        "vToken": "0x18248226c16bf76c032817854e7c83a2113b4f06"
      },
      "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": {
        "aToken": "0x6ab707aca953edaefbc4fd23ba73294241490620",
        "vToken": "0xfb00ac187a8eb5afae4eace434f493eb62672df7"
      },
      "0xd6df932a45c0f255f85145f286ea0b292b21c90b": {
        "aToken": "0xf329e36c7bf6e5e86ce2150875a84ce77f477375",
        "vToken": "0xe80761ea617f66f96274ea5e8c37f03960ecc679"
      },
      "0xe0b52e49357fd4daf2c15e02058dce6bc0057db4": {
        "aToken": "0x8437d7c167dfb82ed4cb79cd44b7a32a1dd95c77",
        "vToken": "0x3ca5fa07689f266e907439afd1fbb59c44fe12f6"
      },
      "0xe111178a87a3bff0c8d18decba5798827539ae99": {
        "aToken": "0x38d693ce1df5aadf7bc62595a37d667ad57922e5",
        "vToken": "0x5d557b07776d12967914379c71a1310e917c7555"
      },
      "0xfa68fb4628dff1028cfec22b4162fccd0d45efb6": {
        "aToken": "0x80ca0d8c38d2e2bcbab66aa1648bd1c7160500fe",
        "vToken": "0xb5b46f918c2923fc7f26db76e8a6a6e9c4347cf9"
      }
    },
    "5000": {
      "0x051665f2455116e929b9972c36d23070f5054ce0": {
        "aToken": "0xf8400f3fa9cd9f9e84e93cd9de9f14eb7b5b59b5",
        "vToken": "0x2e20c5291cd675bfe52a533a6208588f5484999e"
      },
      "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9": {
        "aToken": "0xcb8164415274515867ec43cbd284ab5d6d2b304f",
        "vToken": "0xcea474bda7ad0a8f62e938a5563edfaef7368fc0"
      },
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2": {
        "aToken": "0xaf972f332ff79bd32a6cb6b54f903ea0f9b16c2a",
        "vToken": "0xc42b44c65bbe7aa8e5b02416918688c244ec7847"
      },
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": {
        "aToken": "0xb9aca933c9c0aa854a6dbb7b12f0cc3fdac15ee7",
        "vToken": "0x0169fd279c8c656037e5d199cff8137f1e2d807c"
      },
      "0x779ded0c9e1022225f8e0630b35a9b54be713736": {
        "aToken": "0x7053bad224f0c021839f6ac645bdae5f8b585b69",
        "vToken": "0x5d9e4663d3d532179c404dbe9edf93045f89aded"
      },
      "0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8": {
        "aToken": "0x85d86061e94ce01d3da0f9efa289c86ff136125a",
        "vToken": "0x9c27a8ffacabdee0ac5c415e018d295bb6444f0e"
      },
      "0x93e855643e940d025be2e529272e4dbd15a2cf74": {
        "aToken": "0x5cc6999ac46f4627309a7ce0f321a3f45d138ed5",
        "vToken": "0x7c5549de0deb930bab1e11b075151a19e400605c"
      },
      "0xc96de26018a54d51c097160568752c4e3bd6c364": {
        "aToken": "0xfa14c9de267b59a586043372bd98ed99e3ee0533",
        "vToken": "0x691abcd512c1cfef99442b0acd3ed98ee7f4e64e"
      },
      "0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111": {
        "aToken": "0xeac30ed8609f564ae65c809c4bf42db2ff426d2c",
        "vToken": "0x0baf5974838114e7001d02782e6b1d8aee1fc626"
      },
      "0xfc421ad3c883bf9e7c4f42de845c4e4405799e73": {
        "aToken": "0x8917d4ee4609f991b559daf8d0ad1b892c13b127",
        "vToken": "0xee1eabe23fa42028809f587b8fe1936b154d2620"
      }
    },
    "8453": {
      "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": {
        "aToken": "0x7c307e128efa31f540f2e2d976c995e0b65f51f6",
        "vToken": "0x8d2e3f1f4b38aa9f1ced22ac06019c7561b03901"
      },
      "0x236aa50979d5f3de3bd1eeb40e81137f22ab794b": {
        "aToken": "0xbcffb4b3beadc989bd1458740952af6ec8fbe431",
        "vToken": "0x182cdeec1d52ccad869d621ba422f449fa5809f5"
      },
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0xdd5745756c2de109183c6b5bb886f9207bef114d",
        "vToken": "0xbc4f5631f2843488792e4f1660d0a51ba489bdbd"
      },
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": {
        "aToken": "0xcf3d55c10db69f28fd1a75bd73f3d8a2d9c595ad",
        "vToken": "0x1dabc36f19909425f654777249815c073e8fd79f"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7",
        "vToken": "0x24e6e0795b3c7c71d965fcc4f371803d1c1dca1e"
      },
      "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": {
        "aToken": "0x90da57e0a6c0d166bf15764e03b83745dc90025b",
        "vToken": "0x03d01595769333174036832e18fa2f17c74f8161"
      },
      "0x63706e401c06ac8513145b7687a14804d17f814b": {
        "aToken": "0x67eaf2bee4384a2f84da9eb8105c661c123736ba",
        "vToken": "0xcec1ea95ddef7cfc27d3d9615e05b035af460978"
      },
      "0x660975730059246a68521a3e2fbd4740173100f5": {
        "aToken": "0xd7424238ccbe7b7198ab3cfe232e0271e22da7bd",
        "vToken": "0x57b8c05ee2cd9d0143ebc21fbd9288c39b9f716c"
      },
      "0x6bb7a212910682dcfdbd5bcbb3e28fb4e8da10ee": {
        "aToken": "0x067ae75628177fd257c2b1e500993e1a0babcbd1",
        "vToken": "0x38e59ade183bbeb94583d44213c8f3297e9933e9"
      },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        "aToken": "0x4e65fe4dba92790696d040ac24aa414708f5c0ab",
        "vToken": "0x59dca05b6c26dbd64b5381374aaac5cd05644c28"
      },
      "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": {
        "aToken": "0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d",
        "vToken": "0x41a7c3f5904ad176dacbb1d99101f59ef0811dc1"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0xbdb9300b7cde636d9cd4aff00f6f009ffbbc8ee6",
        "vToken": "0x05e08702028de6aad395dc6478b554a56920b9ad"
      },
      "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": {
        "aToken": "0x0a1d576f3efef75b330424287a95a366e8281d54",
        "vToken": "0x7376b2f323dc56fcd4c191b34163ac8a84702dab"
      },
      "0xecac9c5f704e954931349da37f60e39f515c11c1": {
        "aToken": "0x90072a4aa69b5eb74984ab823efc5f91e90b3a72",
        "vToken": "0xa2525b3f058846075506903d792d58c5a0d834c9"
      },
      "0xedfa23602d0ec14714057867a78d01e94176bea0": {
        "aToken": "0x80a94c36747cf51b2fbabdff045f6d22c1930ed1",
        "vToken": "0xe9541c77a111bcaa5df56839bbc50894eba7afcb"
      }
    },
    "42161": {
      "0x17fc002b466eec40dae837fc4be5c67993ddbd6f": {
        "aToken": "0x38d693ce1df5aadf7bc62595a37d667ad57922e5",
        "vToken": "0x5d557b07776d12967914379c71a1310e917c7555"
      },
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0xea1132120ddcdda2f119e99fa7a27a0d036f7ac9",
        "vToken": "0x1ffd28689da7d0148ff0fcb669e9f9f0fc13a219"
      },
      "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": {
        "aToken": "0x078f358208685046a11c85e8ad32895ded33a249",
        "vToken": "0x92b42c66840c7ad907b4bf74879ff3ef7c529473"
      },
      "0x35751007a407ca6feffe80b3cb397736d2cf4dbe": {
        "aToken": "0x8437d7c167dfb82ed4cb79cd44b7a32a1dd95c77",
        "vToken": "0x3ca5fa07689f266e907439afd1fbb59c44fe12f6"
      },
      "0x3f56e0c36d275367b8c502090edf38289b3dea0d": {
        "aToken": "0xc45a479877e1e9dfe9fcd4056c699575a1045daa",
        "vToken": "0x34e2ed44ef7466d5f9e0b782b5c08b57475e7907"
      },
      "0x4186bfc76e2e237523cbc30fd220fe055156b41f": {
        "aToken": "0x6b030ff3fb9956b1b69f475b77ae0d3cf2cc5afa",
        "vToken": "0x80ca0d8c38d2e2bcbab66aa1648bd1c7160500fe"
      },
      "0x5979d7b546e38e414f7e9822514be443a4800529": {
        "aToken": "0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff",
        "vToken": "0x77ca01483f379e58174739308945f044e1a764dc"
      },
      "0x6c84a8f1c29108f47a79964b5fe888d4f4d0de40": {
        "aToken": "0x62fc96b27a510cf4977b59ff952dc32378cc221d",
        "vToken": "0xb5b46f918c2923fc7f26db76e8a6a6e9c4347cf9"
      },
      "0x7dff72693f6a4149b17e7c6314655f6a9f7c8b33": {
        "aToken": "0xebe517846d0f36eced99c735cbf6131e1feb775d",
        "vToken": "0x18248226c16bf76c032817854e7c83a2113b4f06"
      },
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
        "aToken": "0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8",
        "vToken": "0x0c84331e39d6658cd6e6b9ba04736cc4c4734351"
      },
      "0x912ce59144191c1204e64559fe8253a0e49e6548": {
        "aToken": "0x6533afac2e7bccb20dca161449a13a32d391fb00",
        "vToken": "0x44705f578135cc5d703b4c9c122528c73eb87145"
      },
      "0x93b346b6bc2548da6a1e7d98e9a421b42541425b": {
        "aToken": "0x8ffdf2de812095b1d19cb146e4c004587c0a0692",
        "vToken": "0xa8669021776bc142dfca87c21b4a52595bcbb40a"
      },
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831": {
        "aToken": "0x724dc807b04555b71ed48a6896b6f41593b8c637",
        "vToken": "0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6"
      },
      "0xba5ddd1f9d7f570dc94a51479a000e3bce967196": {
        "aToken": "0xf329e36c7bf6e5e86ce2150875a84ce77f477375",
        "vToken": "0xe80761ea617f66f96274ea5e8c37f03960ecc679"
      },
      "0xd22a58f79e9481d1a88e00c343885a588b34b68b": {
        "aToken": "0x6d80113e533a2c0fe82eabd35f1875dcea89ea97",
        "vToken": "0x4a1c3ad6ed28a636ee1751c69071f6be75deb8b8"
      },
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
        "aToken": "0x82e64f49ed5ec1bc6e43dad4fc8af9bb3a2312ee",
        "vToken": "0x8619d80fb0141ba7f184cbf22fd724116d9f7ffc"
      },
      "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8": {
        "aToken": "0x8eb270e296023e9d92081fdf967ddd7878724424",
        "vToken": "0xce186f6cccb0c955445bb9d10c59cae488fea559"
      },
      "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": {
        "aToken": "0x191c10aa4af7c30e871e70c95db0e4eb77237530",
        "vToken": "0x953a573793604af8d41f306feb8274190db4ae0e"
      },
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": {
        "aToken": "0x6ab707aca953edaefbc4fd23ba73294241490620",
        "vToken": "0xfb00ac187a8eb5afae4eace434f493eb62672df7"
      },
      "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": {
        "aToken": "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
        "vToken": "0xfccf3cabbe80101232d343252614b6a3ee81c989"
      }
    },
    "59144": {
      "0x176211869ca2b568f2a7d4ee941e073a821ee1ff": {
        "aToken": "0x374d7860c4f2f604de0191298dd393703cce84f3",
        "vToken": "0x63ab166e6e1b6fb705b6ca23686fad9705eb3534"
      },
      "0x1bf74c010e6320bab11e2e5a532b5ac15e0b8aa6": {
        "aToken": "0x0c7921ab4888fd06731898b3ffffeb06781d5f4f",
        "vToken": "0x37a843725508243952950307ceace7a9f5d5c280"
      },
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0x935efcbefc1df0541afc3fe145134f8c9a0beb89",
        "vToken": "0x1fe3452cef885724f8adf1382ee17d05d7e01cab"
      },
      "0x3aab2285ddcddad8edf438c1bab47e1a9d05a9b4": {
        "aToken": "0x37f7e06359f98162615e016d0008023d910bb576",
        "vToken": "0x74a1b56f5137b00aa0ada1dd964a3a361ecc32e9"
      },
      "0xa219439258ca9da29e9cc4ce5596924745e12b93": {
        "aToken": "0x88231dfec71d4ff5c1e466d08c321944a7adc673",
        "vToken": "0x4cedfa47f7d0e9036110b850ce49f4cd47b28a2f"
      },
      "0xaca92e438df0b2401ff60da7e4337b687a2435da": {
        "aToken": "0x61b19879f4033c2b5682a969cccc9141e022823c",
        "vToken": "0x8619b395fd96dcfe3f2711d8bf84b26338db0294"
      },
      "0xb5bedd42000b71fdde22d3ee8a79bd49a568fc8f": {
        "aToken": "0x58943d20e010d9e34c4511990e232783460d0219",
        "vToken": "0x81c1a619be23050b3242b41a739e6b6cfda56687"
      },
      "0xd2671165570f41bbb3b0097893300b6eb6101e6c": {
        "aToken": "0xcdd80e6211fc767352b198f827200c7e93d7bb04",
        "vToken": "0xf3c806a402e4e9101373f76c05880eeac91bb5b9"
      },
      "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f": {
        "aToken": "0x787897df92703bb3fc4d9ee98e15c0b8130bf163",
        "vToken": "0x0e7543a9da61b2e71fc880685ed2945b7426a689"
      }
    },
    "534352": {
      "0x01f0a31698c4d065659b9bdc21b3610292a1c506": {
        "aToken": "0xd80a5e16dbdc52bd1c947cedfa22c562be9129c8",
        "vToken": "0x009d88c6a6b4caa240b71c98ba93732e26f2a55a"
      },
      "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4": {
        "aToken": "0x1d738a3436a8c49ceffbab7fbf04b660fb528cbd",
        "vToken": "0x3d2e209af5bfa79297c88d6b57f89d792f6e28ee"
      },
      "0x5300000000000000000000000000000000000004": {
        "aToken": "0xf301805be1df81102c957f6d4ce29d2b8c056b2a",
        "vToken": "0xfd7344ceb1df9cf238ecd667f4a6f99c6ef44a56"
      },
      "0xd29687c813d741e2f938f4ac377128810e217b1b": {
        "aToken": "0x25718130c2a8eb94e2e1fafb5f1cdd4b459acf64",
        "vToken": "0xffba405bbf25b2e6c454d18165f2fd8786858c6b"
      },
      "0xf610a9dfb7c89644979b4a0f27063e9e7d7cda32": {
        "aToken": "0x5b1322eeb46240b02e20062b8f0f9908d525b09c",
        "vToken": "0x8a035644322129800c3f747f54db0f4d3c0a2877"
      }
    }
  },
  "AAVE_V3_ETHER_FI": {
    "1": {
      "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
        "aToken": "0xdf7f48892244c6106ea784609f7de10ab36f9c7e",
        "vToken": "0xd2cf07dee40d3d530d15b88d689f5cd97a31fc3d"
      },
      "0x853d955acef822db058eb8505911ed77f175b99e": {
        "aToken": "0x6914eccf50837dc61b43ee478a9bd9b439648956",
        "vToken": "0xfd3ada5aabdc6531c7c2ac46c00ebf870f5a0e6b"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x7380c583cde4409eff5dd3320d93a45d96b80e2e",
        "vToken": "0x9355032d747f1e08f8720cd01950e652ee15cdb7"
      },
      "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": {
        "aToken": "0xbe1f842e7e0afd2c2322aae5d34ba899544b29db",
        "vToken": "0x16264412cb72f0d16a446f7d928dd0d822810048"
      }
    }
  },
  "AAVE_V3_HORIZON": {
    "1": {
      "0x136471a34f6ef19fe571effc1ca711fdb8e49f2b": {
        "aToken": "0xc167932ac4eec2b65844ef00d31b4550250536a5",
        "vToken": "0x818d560bf1e54f92d1089710f9f4b29c2e6c9248"
      },
      "0x14d60e7fdc0d71d8611742720e4c50e7a974020c": {
        "aToken": "0x08b798c40b9ab931356d9ab4235f548325c4cb80",
        "vToken": "0xa0ec4758d806a3f41532c8e97ea0c85940182b0f"
      },
      "0x17418038ecf73ba4026c4f428547bf099706f27b": {
        "aToken": "0xc293744ffbcf46696d589f5c415e71bc491519cd",
        "vToken": "0x1f30d2b155fcda0f7551dc8be5de6a84977685d4"
      },
      "0x2255718832bc9fd3be1caf75084f4803da14ff01": {
        "aToken": "0xe1cfd16b8e4b1c86bb5b7a104cfefbc7b09326dd",
        "vToken": "0xeaf93fd541f11d2617c2915d02f7fe67bca71d4f"
      },
      "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f": {
        "aToken": "0x946281a2d0dd6e650d08f74833323d66ae4c8b12",
        "vToken": "0xdec2401c9b0b2e480e627e2a712c11addbf46e3e"
      },
      "0x43415eb6ff9db7e26a15b704e7a3edce97d31c4e": {
        "aToken": "0x4e58a2e433a739726134c83d2f07b2562e8dfdb3",
        "vToken": "0xc435b02dcbef2e9bde55e28d39f53ddbe0760a2c"
      },
      "0x5a0f93d040de44e78f251b03c43be9cf317dcf64": {
        "aToken": "0xb0ec6c4482ac1ef77be239c0ac833cf37a27c876",
        "vToken": "0x7bd81b1e0137fc0fa013b1de2be81180814c5deb"
      },
      "0x8292bb45bf1ee4d140127049757c2e0ff06317ed": {
        "aToken": "0xe3190143eb552456f88464662f0c0c4ac67a77eb",
        "vToken": "0xace8a1c0ec12ae81814377491265b47f4ee5d3dd"
      },
      "0x8c213ee79581ff4984583c6a801e5263418c4b86": {
        "aToken": "0x844f07ab09aa5dbdce6a9b1206ce150e1eadaccb",
        "vToken": "0x327f61fa4be6f578db5cc51e40da4ec4361a349c"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x68215b6533c47ff9f7125ac95adf00fe4a62f79e",
        "vToken": "0x4139ecbe83d78ef5eff0a6eda6f894be9d590fc7"
      }
    }
  },
  "AAVE_V3_PRIME": {
    "1": {
      "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f": {
        "aToken": "0x18efe565a5373f430e2f809b97de30335b3ad96a"
      },
      "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
        "aToken": "0xc035a7cf15375ce2706766804551791ad035e0c2"
      },
      "0x9d39a5de30e57443bff2a8307a4256c8797a3497": {
        "aToken": "0xc2015641564a5914a17cb9a92ec8d8fecfa8f2d0"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x2a1fbcb52ed4d9b23dad17e1e8aed4bb0e6079b8"
      },
      "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7": {
        "aToken": "0x56d919e7b25aa42f3f8a4bc77b8982048f2e84b4"
      },
      "0xbf5495efe5db9ce00f80364c8b423567e58d2110": {
        "aToken": "0x74e5664394998f13b07af42446380acef637969f"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0xfa1fdbbd71b0aa16162d76914d69cd8cb3ef92da"
      },
      "0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8": {
        "aToken": "0xce8c60fd8390efcc3fc66a3f0bd64beb969e750e"
      },
      "0xdc035d45d973e3ec169d2276ddab16f1e407384f": {
        "aToken": "0x09aa30b182488f769a9824f15e6ce58591da4781"
      }
    }
  },
  "AURELIUS": {
    "5000": {
      "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9": {
        "aToken": "0x833b5c0379a597351c6cd3efe246534bf3ae5f9f",
        "vToken": "0xaa9c890ca3e6b163487de3c11847b50e48230b45"
      },
      "0x201eba5cc46d216ce6dc03f6a759e8e766e956ae": {
        "aToken": "0x893da3225a2fcf13cca674d1a1bb5a2ea1f3dd14",
        "vToken": "0xc799fe29b67599010a55ec14a8031af2a2521470"
      },
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2": {
        "aToken": "0x32670a5337ae105a67312006f190503a0bee4dd2",
        "vToken": "0x899bf182caba1038205d32f22dd88490daa85826"
      },
      "0x5be26527e817998a7206475496fde1e68957c5a6": {
        "aToken": "0xfdd2ebc184b4ff6df14562715452e970c82fe49a",
        "vToken": "0x2d55f5558aea4c25fcc1ff78b10265755aff3856"
      },
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": {
        "aToken": "0x7bdb0095429f8eff1efb718aabc912b2489ba5b3",
        "vToken": "0xcbe019c9c44954d388602a99a45a1d7da61321cf"
      },
      "0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8": {
        "aToken": "0x067ddc903148968d49abc3144fd7619820f16949",
        "vToken": "0x4c3c0650ddcb767d71c91fa89ee9e5a2cd335834"
      },
      "0xc96de26018a54d51c097160568752c4e3bd6c364": {
        "aToken": "0x491f8fbc6b9a5db31c959a702ab6a0dcbea73a48",
        "vToken": "0xd2ea6612f6c7c11626f7d5d801d08b53bce52511"
      },
      "0xcabae6f6ea1ecab08ad02fe02ce9a44f09aebfa2": {
        "aToken": "0xf91798762cc61971df6df0e15f0904e174387477",
        "vToken": "0xd632fd1d737c6db356d747d09642bef8ae453f4d"
      },
      "0xcda86a272531e8640cd7f1a92c01839911b90bb0": {
        "aToken": "0xbb406187c01cc1c9eaf9d4b5c924b7fa37aecefd",
        "vToken": "0x00dfd5f920ccf08eb0581d605bab413d289c21b4"
      },
      "0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111": {
        "aToken": "0xc3b515bca486520483ef182c3128f72ce270c069",
        "vToken": "0x45ccce9bc8e883ef7805ea73b88d5d528c7cec55"
      },
      "0xe6829d9a7ee3040e1276fa75293bde931859e8fa": {
        "aToken": "0x76f727f55074931221fc88a188b7915084011dcf",
        "vToken": "0x0aa17f21dc8977cdf0141e35543f094fb9edaece"
      }
    }
  },
  "GRANARY": {
    "1": {
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0x272cfccefbefbe1518cd87002a8f9dfd8845a6c4",
        "vToken": "0x5eea43129024eee861481f32c2541b12ddd44c08"
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "aToken": "0xe7334ad0e325139329e747cf2fc24538dd564987"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x02cd18c03b5b3f250d2b29c87949cdab4ee11488",
        "vToken": "0xbce07537df8ad5519c1d65e902e10aa48af83d88"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0x58254000ee8127288387b04ce70292b56098d55c",
        "vToken": "0x05249f9ba88f7d98fe21a8f3c460f4746689aea5"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0x9c29a8ec901dbec4fff165cd57d4f9e03d4838f7",
        "vToken": "0x06d38c309d1dc541a23b0025b35d163c25754288"
      }
    },
    "10": {
      "0x1f32b1c2345538c0c6f582fcb022739c4a194ebb": {
        "aToken": "0x1a7450aacc67d90afb9e2c056229973354cc8987",
        "vToken": "0xd0260ea91b263619a27efeef512a04fb482915e7"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0xff94cc8e2c4b17e3cc65d7b83c7e8c643030d936",
        "vToken": "0x0a05d3d77b66af45233599fe4f5558326e4ad269"
      },
      "0x4200000000000000000000000000000000000042": {
        "aToken": "0x30091e843deb234ebb45c7e1da4bbc4c33b3f0b4",
        "vToken": "0xb1afe7c8d6d94e8ef04ab3c99848a3b21a33d9ef"
      },
      "0x68f180fcce6836688e9084f035309e29bf0a2095": {
        "aToken": "0xbd3dbf914f3e9c3133a815b04a4d0e5930957cb9",
        "vToken": "0x62bbfaef552522be2bda7f69cc5b2c36c1879600"
      },
      "0x7f5c764cbc14f9669b88837ca1490cca17c31607": {
        "aToken": "0x7a0fddba78ff45d353b1630b77f4d175a00df0c0",
        "vToken": "0xb271973b367e50fcde5ee5e426944c37045dd0bf"
      },
      "0x8700daec35af8ff88c16bdf0418774cb3d7599b4": {
        "aToken": "0xa73b7c26ef3221bf9ea7e5981840519427f7dcaf",
        "vToken": "0x9dd559b1d7454979b1699d710885ba5c658277e3"
      },
      "0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9": {
        "aToken": "0x8aaa9d29305d331ae67ad65495b9e22cf98f9035",
        "vToken": "0xc0031304549e494f1f48a9ac568242b1a6ca1804"
      },
      "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": {
        "aToken": "0x4e7849f846f8cddaf37c72065b65ec22cecee109",
        "vToken": "0x5c4acfcba420f8a0e14b7aada3d8726452642fbb"
      },
      "0xaddb6a0412de1ba0f936dcaeb8aaa24578dcf3b2": {
        "aToken": "0xc69ec3664687659dc541cd88ef9d52a470b93fbe",
        "vToken": "0xbed938b24e2432168cb1c09f10ec9609bf5badb0"
      },
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
        "aToken": "0x18d2b18af9a1f379025f46b8aeb4af75f6642c9f",
        "vToken": "0xbabdd3e2231990b1f47844536e19b2f1cc1d5077"
      },
      "0xfe8b128ba8c78aabc59d4c64cee7ff28e9379921": {
        "aToken": "0x7fb37ae8be7f6177f265e3ff6d6731672779eb0b",
        "vToken": "0x49e03c399f0f84083d6f6549383fc80d11701bd4"
      }
    },
    "56": {
      "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3": {
        "aToken": "0x6055558d88dde78df51bf9e90bdd225d525cf80b",
        "vToken": "0xa0758cd24cf68f486f3f6d96e833680d4971ccf8"
      },
      "0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
        "aToken": "0x2a050a0d74c9a12ba44bd2aca9d7d7d1bdf988e9",
        "vToken": "0xa7ede8701d7dac898b04ddf27c781b4eb961443f"
      },
      "0x55d398326f99059ff775485246999027b3197955": {
        "aToken": "0x7e25119b5e52c32970161f1e0da3e66bbef100f1",
        "vToken": "0x573bce236692b48f5faa07947e78c1e282e16c28"
      },
      "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": {
        "aToken": "0x6c578574a5400c5e45f18be65227cfc2a64d94f7",
        "vToken": "0x7f459f3c6d068168ef791746602ca29180b5d03f"
      },
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
        "aToken": "0xe37bbfdd50b715d49df6e596f9248bfe6b967cd7",
        "vToken": "0x2f4e44316af0cac2154f95acca305082a2382e98"
      },
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": {
        "aToken": "0x70ad5e32e6ea548dce7d331b447c2791cf695a98",
        "vToken": "0x839c8ca0873de853c5f8df1ef3e82e9da398abf6"
      }
    },
    "8453": {
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": {
        "aToken": "0x272cfccefbefbe1518cd87002a8f9dfd8845a6c4",
        "vToken": "0x5eea43129024eee861481f32c2541b12ddd44c08"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0x9c29a8ec901dbec4fff165cd57d4f9e03d4838f7",
        "vToken": "0x06d38c309d1dc541a23b0025b35d163c25754288"
      },
      "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": {
        "aToken": "0xe7334ad0e325139329e747cf2fc24538dd564987",
        "vToken": "0xe5415fa763489c813694d7a79d133f0a7363310c"
      },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        "aToken": "0xc17312076f48764d6b4d263efdd5a30833e311dc",
        "vToken": "0x3f332f38926b809670b3cac52df67706856a1555"
      },
      "0x940181a94a35a4569e4529a3cdfb74e38fd98631": {
        "aToken": "0xe3f709397e87032e61f4248f53ee5c9a9abb6440",
        "vToken": "0x083e519e76fe7e68c15a6163279eaaf87e2addae"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0x58254000ee8127288387b04ce70292b56098d55c",
        "vToken": "0x05249f9ba88f7d98fe21a8f3c460f4746689aea5"
      },
      "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": {
        "aToken": "0x02cd18c03b5b3f250d2b29c87949cdab4ee11488",
        "vToken": "0xbce07537df8ad5519c1d65e902e10aa48af83d88"
      }
    },
    "42161": {
      "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": {
        "aToken": "0x731e2246a0c67b1b19188c7019094ba9f107404f",
        "vToken": "0x8daec4344a99f575b13de9f16c53d5bf65e75a42"
      },
      "0x5979d7b546e38e414f7e9822514be443a4800529": {
        "aToken": "0x93e5e80029b36e5e5e75311cf50ebc60995f9ea6",
        "vToken": "0x5d13ffbc005a2bdd16f3c50e527d42c387759299"
      },
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
        "aToken": "0x712f1955e5ed3f7a5ac7b5e4c480db8edf9b3fd7",
        "vToken": "0xc5e029c1097d9585629ae4bdf74c37182ec8d1ba"
      },
      "0x912ce59144191c1204e64559fe8253a0e49e6548": {
        "aToken": "0x8b9a4ded05ad8c3ab959980538437b0562dbb129",
        "vToken": "0x5935530b52332d1030d98c1ce06f2943e06b75ad"
      },
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831": {
        "aToken": "0x2af47e1786c1af2debee2dede590a0d00005129b",
        "vToken": "0x86547cb041c7a98576da7fa87acd6eac66c51e0c"
      },
      "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": {
        "aToken": "0xfc2eac1aeb490d5ff727e659273c8afc5dd2b0bb",
        "vToken": "0xfdf4ee30ceff9a6253d4eb43257abc361433bf04"
      },
      "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8": {
        "aToken": "0x883b786504a2c6bfa2c9e578e5d1752ecbc24dee",
        "vToken": "0x458d60c27b433a157462c7959e2a103389de3fce"
      },
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": {
        "aToken": "0x66ddd8f3a0c4ceb6a324376ea6c00b4c8c1bb3d9",
        "vToken": "0x3e2deeda33d8ba579430f38868db3ed0e2394576"
      },
      "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8": {
        "aToken": "0x6c4cb1115927d50e495e554d38b83f2973f05361",
        "vToken": "0xe2b1674f85c8a1729567f38cb502088c6e147938"
      }
    },
    "59144": {
      "0x176211869ca2b568f2a7d4ee941e073a821ee1ff": {
        "aToken": "0x5c4866349ff0bf1e7c4b7f6d8bb2dbcbe76f8895",
        "vToken": "0x157903b7c6d759c9d3c65a675a15aa0723eea95b"
      },
      "0x3aab2285ddcddad8edf438c1bab47e1a9d05a9b4": {
        "aToken": "0xdc66ac2336742e387b766b4c264c993ee6a3ef28",
        "vToken": "0x9576c6fdd82474177781330fc47c38d89936e7c8"
      },
      "0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5": {
        "aToken": "0x245b368d5a969179df711774e7bdc5ec670e92ef",
        "vToken": "0xd4c3692b753302ef0ef1d50dd7928d60ef00b9ff"
      },
      "0xa219439258ca9da29e9cc4ce5596924745e12b93": {
        "aToken": "0xa0f8323a84adc89346ed3f7c5dcddf799916b51e",
        "vToken": "0x393a64fc561d6c8f5d8d8c427005cab66dfeca9d"
      },
      "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f": {
        "aToken": "0xb36535765a7421b397cfd9fec03cf96aa99c8d08",
        "vToken": "0xd8a40a27dd36565cc2b17c8b937ee50b69209e22"
      }
    }
  },
  "KINZA": {
    "1": {
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0x48dfa0f826e8026ba51342fff61e9584eccadf69",
        "vToken": "0xe9e4064e4e4f7dacb787c5466dbca8579b9def2b"
      },
      "0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f": {
        "aToken": "0x31fd1bf3c7cd90b9bec6cde73fb51763365a5522",
        "vToken": "0xef0791c1906190977906a49f76d3270b4c03f0c4"
      },
      "0x657e8c867d8b37dcc18fa4caead9c45eb088c642": {
        "aToken": "0x022c0c5d172c91e7428867549db2a77aff86059a",
        "vToken": "0xb9ff21d4e4cbd1cee4c1cfd0f3c953d515d9b2c8"
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "aToken": "0x75287853d44f263639af649283403ec39f895dab",
        "vToken": "0xf8f0198a277f71f15d4e8c32ae533f36dfa3084a"
      },
      "0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5": {
        "aToken": "0x7aae11fac797e9b21794abd8132079cc64b6b4d4",
        "vToken": "0x992d2d8387b0cd432408907dd5eac70e18760e38"
      },
      "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
        "aToken": "0xf818fbb391f0e84b620d48d8c2c8345e59f605eb",
        "vToken": "0xa4e3adba0308c4e12dfc9489f11200395537a29f"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x89c15cade77cba4f5c78d1fa845b854623ad8696",
        "vToken": "0xa3c0a19b999ff397a4b3c62ca10611eee315f426"
      },
      "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7": {
        "aToken": "0x0cf5a1ab4185c69ef715190b9c9f93b3b05ff55b",
        "vToken": "0xaf3b303f904cada1e4a648555f78735bb432106b"
      },
      "0xae78736cd615f374d3085123a210448e74fc6393": {
        "aToken": "0x16e22798a2064adfaa09fd7c380d5ca8c895c296",
        "vToken": "0x240c6bab702ba827ed11a99df390326ad6662119"
      },
      "0xbf5495efe5db9ce00f80364c8b423567e58d2110": {
        "aToken": "0x6679dfcbc9000dcf9a798b8f0f2b1c12d164cdd4",
        "vToken": "0xd025bbac4d3a7ab979dc0bb82f0466417d76e952"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0x6bdcbef41ca2abe587ce7ccc895320e0061edba4",
        "vToken": "0xcd74352a42940cdf07bf494babf2b289696f7a0c"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0x23a1e3281500ab6cf9f7cae71939a6cbfbe79435",
        "vToken": "0x8b134d066242e74e65d7da62953350cce4d2d022"
      },
      "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": {
        "aToken": "0xd7ecacf4cdae0c59cdd034c6f0d959e7933bfd6c",
        "vToken": "0x2cf0f840d0dcc15daa37f4899371951b934c02ac"
      },
      "0xd9a442856c234a39a81a089c06451ebaa4306a72": {
        "aToken": "0x5651bb75de3c78815d420602b4ce67d04a233873",
        "vToken": "0x62c4405476250d28af421ca7839064ce4ad96b5f"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0xf96eb7018654082198da9be23dd8ab1cd05a175b",
        "vToken": "0x271e7ba790dded05e5f1cffdf6f75d0e069c34db"
      }
    },
    "56": {
      "0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5": {
        "aToken": "0xc16bbfba00a2264aab2883c49d53833f42c80b95",
        "vToken": "0x00107060f34b437c5a7daf6c247e6329cf613759"
      },
      "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82": {
        "aToken": "0xa8d9bfcd2b4bb9c30794ad7d49ab1b8da2b9f700",
        "vToken": "0x55371316eb587078c5576f0f24597b1e92c5b208"
      },
      "0x1346b618dc92810ec74163e4c27004c921d446a5": {
        "aToken": "0xe0169336403f03922bbf66ca01394e4191b87c78",
        "vToken": "0x910d7ce736ee2e7f108ad2fffea66d19a8179cbb"
      },
      "0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
        "aToken": "0xfd087dd64fb79e749fd8c85c64096144118b9554",
        "vToken": "0xb5d9e75141dc6c264666782fa31c1b4330a5e6b4"
      },
      "0x23ae4fd8e7844cdbc97775496ebd0e8248656028": {
        "aToken": "0xc390614e71512b2aa9d91afa7e183cb00eb92518",
        "vToken": "0xa5b7da4e275b1e8a5fa0b5c9088a937af5d565d2"
      },
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0x19136a96b202685a2768eb99068adf3341414bdb",
        "vToken": "0xed692ba8dfabddcaeac2bb76f833e00906824874"
      },
      "0x2dd73dcc565761b684c56908fa01ac270a03f70f": {
        "aToken": "0x9f65da9bd6bc7d14eacff42e918344784dfc2384",
        "vToken": "0x0d2ef920e4ddf573266ef9b6304407b64127e8b7"
      },
      "0x40af3827f39d0eacbf4a168f8d4ee67c121d11c9": {
        "aToken": "0xc65132d8289d39bccc3b0e72a8b901b8b180e7d9",
        "vToken": "0x0158d5a1d32f96f4ce68bed28f9addb0c43361e5"
      },
      "0x45b817b36cadba2c3b6c2427db5b22e2e65400dd": {
        "aToken": "0xeeaa5aa3388d6a2796ac815447a301607b52d25f",
        "vToken": "0x23cfae853cdf08d3efe4817e2016dbe47b937d35"
      },
      "0x4aae823a6a0b376de6a78e74ecc5b079d38cbcf7": {
        "aToken": "0x446b2ab906c20f9aea62b03c86b332004eceaadc",
        "vToken": "0xa66ae2356735ec9cd35ede3ed87e556561ce462a"
      },
      "0x55d398326f99059ff775485246999027b3197955": {
        "aToken": "0xa1c7f76cbcdb87b17abf825ec2b5a1eb823e26f1",
        "vToken": "0xb82c3631081ee5d1339e77b46c3e476f1fdd4a19"
      },
      "0x64274835d88f5c0215da8aadd9a5f2d2a2569381": {
        "aToken": "0x9c6fae23fdfffbe1199babb11bc9a6859493a5a1",
        "vToken": "0x9cf92292c4d58745964c7ea076950438f519f3fb"
      },
      "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": {
        "aToken": "0x95aae09ad8557126b169056b9bd0ff6b5456239d",
        "vToken": "0x2682bd101e64f0367d3ac1261eb311eed8b7f751"
      },
      "0x80137510979822322193fc997d400d5a6c747bf7": {
        "aToken": "0x96619fc54940e4147f2445b06be857e8f11f5e8a",
        "vToken": "0xd197294763a82b930ab578491dfbd293846f759e"
      },
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
        "aToken": "0x26c8c9d74eae6182316b30de9ac60e2adc9f4a04",
        "vToken": "0x6dadaaf2d4a191db51854a60e4a6e23d3776eb16"
      },
      "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d": {
        "aToken": "0xe48967b3ea41484cf70f171627948084cb796f5c",
        "vToken": "0x7a07518d4bfcbf3baddf69718711345dd4907c19"
      },
      "0xa2e3356610840701bdf5611a53974510ae27e2e1": {
        "aToken": "0xb98eaf6ca73c13c7533daa722223e3dc32dd0ee5",
        "vToken": "0xb9755ecea9bb7080414b0a3a4c9504f985f3f9ad"
      },
      "0xb0b84d294e0c75a6abe60171b70edeb2efd14a1b": {
        "aToken": "0xa79befa293c06396dc49f5f80c07c2f44862eefc",
        "vToken": "0xee302680c91ea5773c7dc11f6d4a4096f22c1f04"
      },
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": {
        "aToken": "0xf5e0adda6fb191a332a787deedfd2cffc72dba0c",
        "vToken": "0xeabcda7cfb0780a028c1fd1162e52942b96fbe10"
      },
      "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": {
        "aToken": "0x8473168406d620b5cf2fc55e80b6d331e737d2e1",
        "vToken": "0x74afc76da686cac5ec786566e128cfe61822c055"
      },
      "0xcee8c9ccd07ac0981ef42f80fb63df3cc36f196e": {
        "aToken": "0xc5606c8a773f4399d52391830522f113a1448404",
        "vToken": "0x658823636ba31060382ea01cebb9b6b3ffe80985"
      },
      "0xe9e7cea3dedca5984780bafc599bd69add087d56": {
        "aToken": "0x77800d2550d1115fb2cdbff440f85d98a1792139",
        "vToken": "0x1e91220b7321767a7b1c2ba7584ee32bbbf278fd"
      },
      "0xeeaa03ed0aa69fcb6e340d47ffa91a0b3426e1cd": {
        "aToken": "0x38fc72e24ea7372c9f9d842467c629680cdb6cbc",
        "vToken": "0xb0298302028681e5d71f1e469842b3e4eafed04b"
      },
      "0xf0daf89f387d9d4ac5e3326eadb20e7bec0ffc7c": {
        "aToken": "0x294c4a3eb851e7b6d296a5e8a250ade2a24dc40d",
        "vToken": "0x2a1431415f9f729c557e6c817eb80791e9d2c974"
      },
      "0xf6718b2701d4a6498ef77d7c152b2137ab28b8a3": {
        "aToken": "0xe4c60c28943a7d8945683d5a6c15f59280a0d29e",
        "vToken": "0xe3c7183648dcae991425fe22117b37aca7e91d3f"
      }
    },
    "5000": {
      "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9": {
        "aToken": "0x1b66b556fe5b75b327d8ec6cc1cb4a8b76963986",
        "vToken": "0x8e5d37568b64e81d99c4fbeaf6981bf83da44bfe"
      },
      "0x201eba5cc46d216ce6dc03f6a759e8e766e956ae": {
        "aToken": "0x6565b79a30f38199679ac604d4d0077a08a7f982",
        "vToken": "0x72a7fce2e6db4347dc9f0e92c81b3a62dea2d829"
      },
      "0x5be26527e817998a7206475496fde1e68957c5a6": {
        "aToken": "0xa077eed346acc9dfa18c9ab7c9d76977495e27ce",
        "vToken": "0x03bf771b1ead173608625264b1702ef96378d875"
      },
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": {
        "aToken": "0xc1dc4f83788edaac72d41e0a2751a194882c86d2",
        "vToken": "0x3f83be6e450a44ced037452185f83d5f8c910089"
      },
      "0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8": {
        "aToken": "0x84bda98851b20ba5d5c39ce1a859a51370195624",
        "vToken": "0x59224ea7f07a7fb0cfea1fc57e8ed2bfe3bd14d9"
      },
      "0xc96de26018a54d51c097160568752c4e3bd6c364": {
        "aToken": "0xb408192471491b4fcdf5483cfe66df9780e8fcdf",
        "vToken": "0x59f476dec1da0ca2d1a1cd7f43a5349cac5c7882"
      },
      "0xcda86a272531e8640cd7f1a92c01839911b90bb0": {
        "aToken": "0x9ac70a8142c616e23d4756268bbc4e6c55bc0d4b",
        "vToken": "0x9e83a5829072e251e5fdbcef89b953e670805b3b"
      },
      "0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111": {
        "aToken": "0x438af1fed30ee1c849e731878fa1901a6b61a723",
        "vToken": "0x9b2b7b7c38fc3b70045f7e3cb282d30ae31dccde"
      }
    }
  },
  "LENDLE": {
    "5000": {
      "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": {
        "aToken": "0x90f22aa619217765c8ea84b18130ff60ad0d5de1",
        "vToken": "0xa1d2e7033d691a2b87a92f95c6735fdbc2032b9a"
      },
      "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9": {
        "aToken": "0xf36afb467d1f05541d998bbbcd5f7167d67bd8fc",
        "vToken": "0x334a542b51212b8bcd6f96efd718d55a9b7d1c35"
      },
      "0x201eba5cc46d216ce6dc03f6a759e8e766e956ae": {
        "aToken": "0xe71cbaaa6b093fce66211e6f218780685077d8b5",
        "vToken": "0xac3c14071c80819113df501e1ab767be910d5e5a"
      },
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2": {
        "aToken": "0x8e3f5e745a030a384fbd19c97a56da5337147376",
        "vToken": "0x48b6c9ad51009061f02ba36cddc4bf5ffd08519e"
      },
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": {
        "aToken": "0x2cfa1e69c8a8083aa52cfcf22d8caff7521e1e7e",
        "vToken": "0x08c830f79917205ff1605325fcfbb3efc0c16cb5"
      },
      "0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8": {
        "aToken": "0x683696523512636b46a826a7e3d1b0658e8e2e1c",
        "vToken": "0x18d3e4f9951fedcddd806538857ebed2f5f423b7"
      },
      "0xc96de26018a54d51c097160568752c4e3bd6c364": {
        "aToken": "0xdef3542bb1b2969c1966dd91ebc504f4b37462fe",
        "vToken": "0x874712c653aaaa7cfb201317f46e00238c2649bb"
      },
      "0xcabae6f6ea1ecab08ad02fe02ce9a44f09aebfa2": {
        "aToken": "0x44cccbbd7a5a9e2202076ea80c185da0058f1715",
        "vToken": "0x42f9f9202d5f4412148662cf3bc68d704c8e354f"
      },
      "0xcda86a272531e8640cd7f1a92c01839911b90bb0": {
        "aToken": "0x0e927aa52a38783c1fd5dfa5c8873cbdbd01d2ca",
        "vToken": "0xd739fb7a3b652306d00f92b20439afc637650254"
      },
      "0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111": {
        "aToken": "0x787cb0d29194f0faca73884c383cf4d2501bb874",
        "vToken": "0x5df9a4be4f9d717b2bfece9ec350dcf4cbcb91d8"
      },
      "0xe6829d9a7ee3040e1276fa75293bde931859e8fa": {
        "aToken": "0x68a1b2756b41ce837d73a801e18a06e13eac50e1",
        "vToken": "0x880a809ca9dc0a35f5015d31f1f2273a489695eb"
      }
    }
  },
  "RADIANT_V2": {
    "1": {
      "0x18084fba666a33d37592fa2633fd49a74dd93a88": {
        "aToken": "0x457885e79a6627318721f86d16601fb42f4ad052",
        "vToken": "0xb146dacc41ee3bf5acda69f232f32db74f00570e"
      },
      "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
        "aToken": "0xe2a9e57b7a4a4f85bca3aa2cded9ae98647066c9",
        "vToken": "0xec8218d3f2155bcd9ddf1e8d7f228864a2e052d9"
      },
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0xe57538e4075446e42907ea48abfa83b864f518e4",
        "vToken": "0x0184eb8a4d86ff250cb2f7f3146aecc14ccb73a4"
      },
      "0x45804880de22913dafe09f4980848ece6ecbaf78": {
        "aToken": "0xf63667fab833b603252482de83de152034c2b7ab",
        "vToken": "0xe45c5c5e45782cdd46b0d714fbfc65e906fd910e"
      },
      "0x4c9edd5852cd905f086c759e8383e09bff1e68b3": {
        "aToken": "0xa6ea758c6e447b7c134dd2f1c11187eaff26279b",
        "vToken": "0x8bec003e9fea2ff3b25ed7bcda3a7280217a8385"
      },
      "0x514910771af9ca656af840dff83e8264ecf986ca": {
        "aToken": "0x0b87df21f2e093f779f846fe388d9688c343d5e7",
        "vToken": "0x660fe1fab4079d6abc335a117c8fc4cb2db88375"
      },
      "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
        "aToken": "0x24378aa0d97e3bd72bd0a0443306602de4583456",
        "vToken": "0xac1bbb316c84b672a86aabec5d4ec53b8d26ce98"
      },
      "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
        "aToken": "0x83b3896ec36cb20cfb430fcfe8da23d450dd09b5",
        "vToken": "0xc8cbb48a0eed0e406bb52a5cc939358c0ab644a7"
      },
      "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9": {
        "aToken": "0x250ee3866880524423d5bb7059a9d33678475b6f",
        "vToken": "0x31affa4d49122f8ecd984f2ead2dda3f574fbdc2"
      },
      "0x8236a87084f8b84306f72007f36f2618a5634494": {
        "aToken": "0x37b64fc5babdf70a027099fc7b75bf77a0b23e34",
        "vToken": "0x8715d51b9760ee99cf4c623337ec5d673434cc3f"
      },
      "0x83f20f44975d03b1b09e64809b757c47f942beea": {
        "aToken": "0x473693ecdad05f5002ff5f63880cfa5901fb50e8",
        "vToken": "0xe491c1a4150e9925e8427bea4cdcbd250b730e5c"
      },
      "0x9d39a5de30e57443bff2a8307a4256c8797a3497": {
        "aToken": "0x25de46b8491c43c88c9e615336210928ca64091c",
        "vToken": "0xa9f3915ed6d1473aee84a3666155ea8a84719177"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x9e85df2b42b2ae5e666d7263ed81a744a534bf1f",
        "vToken": "0x490726291f6434646feb2ec96d2cc566b18a122f"
      },
      "0xae78736cd615f374d3085123a210448e74fc6393": {
        "aToken": "0x03ab03da2c5012855c743bc318c19ef3de5bc906",
        "vToken": "0x6a0e8b4d16d5271492bb151eb4767f25cfc23f03"
      },
      "0xbe9895146f7af43049ca1c1ae358b0541ea49704": {
        "aToken": "0xa9f92e32a1c0c0bdc58eae49585ffb2e3b8a99d2",
        "vToken": "0xb41bd965fd0954c3bd4edae1a9a07816788b657c"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0xd10c315293872851184f484e9431daf4de6aa992",
        "vToken": "0xdf1e9234d4f10ef9fed26a7ae0ef43e5e03bfc31"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0xdd4c49dac41ed743052e9f7abac316b76ee42e36",
        "vToken": "0xba831825e3bc7cdafb59ca02ed2b31a1232d3b33"
      },
      "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": {
        "aToken": "0x1d25bd8abfeb1d6517cc21beca20b5cd2df8247c",
        "vToken": "0xcde79c767826849e30aae7c241c369fce54db707"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0x3c19d9f2df0e25c077a637692da2337d51daf8b7",
        "vToken": "0x2d4fc0d5421c0d37d325180477ba6e16ae3abaa7"
      },
      "0xdc035d45d973e3ec169d2276ddab16f1e407384f": {
        "aToken": "0x8dd4d313ded77c399fed700d54cbdea2c24227d6",
        "vToken": "0x85f97456d05bafa87e09c75a7e8c8238cfa9c9c7"
      }
    },
    "56": {
      "0x2170ed0880ac9a755fd29b2688956bd959f933f8": {
        "aToken": "0x36594b6c976d05a6ff442b38cfc3efe0c01e0359",
        "vToken": "0x7473d4eddd1d78b7df950219003d1b9d74e3980f"
      },
      "0x26c5e01524d2e6280a48f2c50ff6de7e52e9611c": {
        "aToken": "0x701810c95aa1521d56c2be5848a1b15be5954ec3",
        "vToken": "0x5cc83215c1e225105fe787b6f21a884c75aecf22"
      },
      "0x55d398326f99059ff775485246999027b3197955": {
        "aToken": "0x9915a7389f8fb33f9b77d84119c06e8bffb12be4",
        "vToken": "0xc1e02d3f3c7282cc2d15fb6a5cc40130427107b1"
      },
      "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c": {
        "aToken": "0xd083fb8db6dbc83386dc20075bec8d0722b3056b",
        "vToken": "0xc589b9ae9e4aa780af7a6bc2e9de27a532b2a278"
      },
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
        "aToken": "0x15cc621cfd1d0527ce6894fc07d97b2c06520d57",
        "vToken": "0x94b6f75cb5c5e01cdfd1396420b499f3a7496300"
      },
      "0xa2e3356610840701bdf5611a53974510ae27e2e1": {
        "aToken": "0xd456f6216cb098b7999c76be4f58f5121bad8be8",
        "vToken": "0x75ccd694d057086db838e0cbe91e92223a6b5c55"
      },
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": {
        "aToken": "0x40351090037b9c4f6555071e9b24a82b068f2c05",
        "vToken": "0xf81c76a058ed8962b4eae814cd8339790bd7b4c8"
      },
      "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": {
        "aToken": "0xd319e074c789c978e92f20345eb739b9a670e4d8",
        "vToken": "0x054321fe1549502a702883712b70c48977a923bf"
      }
    },
    "8453": {
      "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": {
        "aToken": "0x223a4066bd6a30477ead12a7af52125390c735da",
        "vToken": "0x73a53a1d90fc37bc6ef66e25c819976cc2ad7d22"
      },
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": {
        "aToken": "0x20508ba938fedae646fcad48416bc9b6a448786e",
        "vToken": "0xf349787fed9c02bb7d4928fbc2c3d51a38ed7fbb"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0x47cefa4f2170e6cba87452e9053540e05182a556",
        "vToken": "0x2455485c868c94781aa25f3fe9a5f9a6771d659c"
      },
      "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": {
        "aToken": "0xcf2170f09de0df8454c865d972414f5be696cf89",
        "vToken": "0x7a2d83558c405d7179843c338644a22e7e5ba28a"
      },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        "aToken": "0xc2ddb87da8f16f1c3983fa7112419a1381919b14",
        "vToken": "0x392376c337413ce2e9ad7dd5f3468ae58f323b00"
      },
      "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": {
        "aToken": "0x43095e6e52a603fa571dde18a7a123ec407433fe",
        "vToken": "0xb8eb4737c7da019f26a297c8020f024baa0c61d7"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0x633ebd78e0ebe2ff2e2e169a4010b9ca4f7bcaa1",
        "vToken": "0x40eb2d8e246915d768a218880cc52bc6993dc2b4"
      },
      "0xecac9c5f704e954931349da37f60e39f515c11c1": {
        "aToken": "0x6f77be7bbd7c24565a68781030341a7e3db2946a",
        "vToken": "0xdd8ff03a171e976fb5624e9ebc1d397cb242c4be"
      }
    },
    "42161": {
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0x3c284500401c12d873ff156b131901ab73cca34e",
        "vToken": "0x0e95fe1da263f267a6b7c7fe9632bf2a6b178c66"
      },
      "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": {
        "aToken": "0xa366742d785c288ecad8120d5303db4eb675c9ec",
        "vToken": "0x2ceca734ae0a437314a73401db89a2560584b17f"
      },
      "0x35751007a407ca6feffe80b3cb397736d2cf4dbe": {
        "aToken": "0x44e1c41e6ca07198edbdb4d3e41a7def2e06cd8f",
        "vToken": "0x04f2a8f7fcc86cddcca89e1ea98f333cc072fb95"
      },
      "0x4186bfc76e2e237523cbc30fd220fe055156b41f": {
        "aToken": "0x75ec0fccabb297849bbcb4c2a1c3b760f1d8968f",
        "vToken": "0xb73d597f15278be1233f0822b177df2f90af5e2a"
      },
      "0x47c031236e19d024b42f8ae6780e44a573170703": {
        "aToken": "0x97a786fa951712ab10c16681a5acd9fabcea285e",
        "vToken": "0x29adee4bde1f1b8faf278806e3974f22fae64f01"
      },
      "0x528a5bac7e746c9a509a1f4f6df58a03d44279f9": {
        "aToken": "0xcbb44d744a12676797033bbd65c6b3d61f02f183",
        "vToken": "0x7f93220b3c307b428dbb7a90ac56bcee3b257b64"
      },
      "0x5979d7b546e38e414f7e9822514be443a4800529": {
        "aToken": "0xbe6e57d96674e4873173da7d48c1efbc55f2fa37",
        "vToken": "0x78587e08e71a65976e98e4eef9f3337a1dfb6eba"
      },
      "0x70d95587d40a2caf56bd97485ab3eec10bee6336": {
        "aToken": "0x7fa17fad637bbe6b58e6cec266687006e137bce7",
        "vToken": "0x2b2b3d665e88d78b47615e7d43b298a39135268f"
      },
      "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": {
        "aToken": "0xfb6f79db694ab6b7bf9eb71b3e2702191a91df56",
        "vToken": "0x330243dcbd91acdd99b73a7c73c8a46e47fe386c"
      },
      "0x912ce59144191c1204e64559fe8253a0e49e6548": {
        "aToken": "0xc103b64ae78abdf2b643aa684440ef4cf3759b0b",
        "vToken": "0x60a60e28fd7e44c60c4087837716374b14c7450d"
      },
      "0xaf88d065e77c8cc2239327c5edb3a432268e5831": {
        "aToken": "0xb1d71c15d7c00a1b38c7ad182fa49889a70db4be",
        "vToken": "0x7bf39af1dd18d6dafca6b931589ef850f9d0be25"
      },
      "0xdf03eed325b82bc1d4db8b49c30ecc9e05104b96": {
        "aToken": "0x5496524c97c5dd5f03d3a53179138a2dc1e17d88",
        "vToken": "0x1b103f61765b72afd2d6b64876fbe0db5cf4f416"
      },
      "0xec70dcb4a1efa46b8f2d97c310c9c4790ba5ffa8": {
        "aToken": "0x24957644116967962bf1f507e7ad9498836a0132",
        "vToken": "0x9d4179826950a36a46144aedb51269ca6c4ae87b"
      },
      "0xf97f4df75117a78c1a5a0dbb814af92458539fb4": {
        "aToken": "0x1f6ce88620326b146c47cccd115d23ee48042b9f",
        "vToken": "0x469be5f178c3b4bc43f8ac420958d58f8889e5f8"
      },
      "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": {
        "aToken": "0x62f9f05f3af1a934f0e02ead202e3de36a6501e6",
        "vToken": "0xe0499561642aff7a149f59cc599484d9d2dc60da"
      }
    }
  },
  "SPARK": {
    "1": {
      "0x18084fba666a33d37592fa2633fd49a74dd93a88": {
        "aToken": "0xce6ca9cdce00a2b0c0d1dac93894f4bd2c960567",
        "vToken": "0x764591dc9ba21c1b92049331b80b6e2a2acf8b17"
      },
      "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
        "aToken": "0x4197ba364ae6698015ae5c1468f54087602715b2",
        "vToken": "0xf6fee3a8ac8040c3d6d81d9a4a168516ec9b51d2"
      },
      "0x6810e776880c02933d47db1b9fc05908e5386b96": {
        "aToken": "0x7b481acc9fdaddc9af2cbea1ff2342cb1733e50f",
        "vToken": "0x57a2957651da467fcd4104d749f2f3684784c25a"
      },
      "0x6b175474e89094c44da98b954eedeac495271d0f": {
        "aToken": "0x4dedf26112b3ec8ec46e7e31ea5e123490b05b8b",
        "vToken": "0xf705d2b7e92b3f38e6ae7afadaa2fee110fe5914"
      },
      "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
        "aToken": "0x779224df1c756b4edd899854f32a53e8c2b2ce5d",
        "vToken": "0x3357d2db7763d6cd3a99f0763ebf87e0096d95f9"
      },
      "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
        "aToken": "0x12b54025c112aa61face2cdb7118740875a566e9",
        "vToken": "0xd5c3e3b566a42a6110513ac7670c1a86d76e13e6"
      },
      "0x8236a87084f8b84306f72007f36f2618a5634494": {
        "aToken": "0xa9d4ecebd48c282a70cfd3c469d6c8f178a5738e",
        "vToken": "0x096bddfee63f44a97cc6d2945539ee7c8f94637d"
      },
      "0x83f20f44975d03b1b09e64809b757c47f942beea": {
        "aToken": "0x78f897f0fe2d3b5690ebae7f19862deacedf10a7",
        "vToken": "0xabc57081c04d921388240393ec4088aa47c6832b"
      },
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
        "aToken": "0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815",
        "vToken": "0x7b70d04099cb9cfb1db7b6820badafb4c5c70a67"
      },
      "0xa1290d69c65a6fe4df752f95823fae25cb99e5a7": {
        "aToken": "0x856f1ea78361140834fdcd0db0b08079e4a45062",
        "vToken": "0xc528f0c91cfae4fd86a68f6dfd4d7284707bec68"
      },
      "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd": {
        "aToken": "0x6715bc100a183cc65502f05845b589c1919ca3d3",
        "vToken": "0x4e89b83f426fed3f2ef7bb2d7eb5b53e288e1a13"
      },
      "0xae78736cd615f374d3085123a210448e74fc6393": {
        "aToken": "0x9985df20d7e9103ecbceb16a84956434b6f06ae8",
        "vToken": "0xba2c8f2ea5b56690bfb8b709438f049e5dd76b96"
      },
      "0xbf5495efe5db9ce00f80364c8b423567e58d2110": {
        "aToken": "0xb131cd463d83782d4de33e00e35ef034f0869ba1",
        "vToken": "0xb0b14dd477e6159b4f3f210cf45f0954f57c0fab"
      },
      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
        "aToken": "0x59cd1c87501baa753d0b5b5ab5d8416a45cd71db",
        "vToken": "0x2e7576042566f8d6990e07a1b61ad1efd86ae70d"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0xb3973d459df38ae57797811f2a1fd061da1bc123",
        "vToken": "0x661fe667d2103eb52d3632a3eb2cabd123f27938"
      },
      "0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee": {
        "aToken": "0x3cfd5c0d4acaa8faee335842e4f31159fc76b008",
        "vToken": "0xc2bd6d2fee70a0a73a33795bdbee0368aef5c766"
      },
      "0xdac17f958d2ee523a2206206994597c13d831ec7": {
        "aToken": "0xe7df13b8e3d6740fe17cbe928c7334243d86c92f",
        "vToken": "0x529b6158d1d2992e3129f7c69e81a7c677dc3b12"
      },
      "0xdc035d45d973e3ec169d2276ddab16f1e407384f": {
        "aToken": "0xc02ab1a5eaa8d1b114ef786d9bde108cd4364359",
        "vToken": "0x8c147debea24fb98ade8dda4bf142992928b449e"
      }
    }
  },
  "ZEROLEND": {
    "8453": {
      "0x04d5ddf5f3a8939889f11e97f8c4bb48317f1938": {
        "aToken": "0x9357e7f1c49e6d0094287f882fc47774fd3bc291",
        "vToken": "0x19887e3d984cbbd75805dfdbc9810efe923b897f"
      },
      "0x0a27e060c0406f8ab7b64e3bee036a37e5a62853": {
        "aToken": "0x2e1f66d89a95a88afe594f6ed936b1ca76efb74c",
        "vToken": "0x5e4043a302a827bfa4cb51fa18c66109683d08ee"
      },
      "0x1097dfe9539350cb466df9ca89a5e61195a520b0": {
        "aToken": "0x89bb87137afe8bae03f4ab286de667a513ceebdd",
        "vToken": "0x6b0b75c223ddd146b213ef4e35bc61d1de7b46a4"
      },
      "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": {
        "aToken": "0x1f3f89ffc8cd686cecc845b5f52246598f1e3196",
        "vToken": "0x371cfa36ef5e33c46d1e0ef2111862d5ff9f78cd"
      },
      "0x35e5db674d8e93a03d814fa0ada70731efe8a4b9": {
        "aToken": "0x9e08e9119883f9ffc59f97bbab45340f4da0db39",
        "vToken": "0x4dfa4449f0ddd7fdea916d1242acd8a7f78259df"
      },
      "0x4200000000000000000000000000000000000006": {
        "aToken": "0x4677201dbb575d485ad69e5c5b1e7e7888c3ab29",
        "vToken": "0xfec889b48d8cb51bfd988bf211d4cfe854af085c"
      },
      "0x5d746848005507da0b1717c137a10c30ad9ee307": {
        "aToken": "0x09ff10b3bd188eaf1b972379cc4940833361e5a8",
        "vToken": "0xa59ba82be54926368407f67fc80a26e4768b6dd1"
      },
      "0x69000dfd5025e82f48eb28325a2b88a241182ced": {
        "aToken": "0xb2de5acea05a42b05d05bcf252a2e15a3c93c19e",
        "vToken": "0xc9fcd2e88662191706657adc69a3cbdd641d53ae"
      },
      "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d": {
        "aToken": "0xb6ccd85f92fb9a8bbc99b55091855714aaeebfee",
        "vToken": "0x80e898e5ad81940fe094ac3159b08a3494198570"
      },
      "0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6": {
        "aToken": "0x134efc999957fc7984c5ab91bc7ec0f0d373b71e",
        "vToken": "0x1c7f3d9d02ad5fefd1a8feed65957be1ea5f649c"
      },
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
        "aToken": "0xd09600475435cab0e40dabdb161fb5a3311efcb3",
        "vToken": "0xa397391b718f3c7f21c63e8beb09b66607419c38"
      },
      "0x940181a94a35a4569e4529a3cdfb74e38fd98631": {
        "aToken": "0x3c2b86d6308c24632bb8716ed013567c952b53ae",
        "vToken": "0x98ef767a6184323bf2788a0936706432698d3400"
      },
      "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": {
        "aToken": "0x4433cf6e9458027ff0833f22a3cf73318908e48e",
        "vToken": "0x7e1b2ac5339e8bba83c67a9444e9ee981c46ce42"
      },
      "0xdbfefd2e8460a6ee4955a68582f85708baea60a3": {
        "aToken": "0xe48d605bb303f7e88561a9b09640af4323c5b921",
        "vToken": "0xd6290195faab4b78f43eb38554e36f243218f334"
      },
      "0xe31ee12bdfdd0573d634124611e85338e2cbf0cf": {
        "aToken": "0xf382e613ff8ee69f3f7557424e7cfd48792286c5",
        "vToken": "0x591d8d962278bd35182decb2852de50f83dd29d0"
      },
      "0xe46c8ba948f8071b425a1f7ba45c0a65cbacea2e": {
        "aToken": "0xfc68bfbf891c0e61bc0dba0a2db05632e551e570",
        "vToken": "0x053cf31de7d82deac8e026ac2078bf7d9d3eab14"
      },
      "0xecac9c5f704e954931349da37f60e39f515c11c1": {
        "aToken": "0xbbb4080b4d4510ace168d1ff8c5cc256ab74e1fb",
        "vToken": "0x8307952247925a2ed9f5729eaf67172a77e08999"
      },
      "0xf469fbd2abcd6b9de8e169d128226c0fc90a012e": {
        "aToken": "0x4759417285100f0a11846304af76d1ed8d9ad253",
        "vToken": "0x95beb0d11951e3e4140f1265b3df76f685740e18"
      }
    },
    "59144": {
      "0x15eefe5b297136b8712291b632404b66a8ef4d25": {
        "aToken": "0x03114e4c29ea95bf26108c2c47338488555ced1a",
        "vToken": "0x061ca6fdf24d586ee9a4e4b4a1d61f9090ab48e9"
      },
      "0x176211869ca2b568f2a7d4ee941e073a821ee1ff": {
        "aToken": "0x2e207eca8b6bf77a6ac82763eeed2a94de4f081d",
        "vToken": "0xa2703dc9fbaccd6ec2e4cbfa700989d0238133f6"
      },
      "0x1bf74c010e6320bab11e2e5a532b5ac15e0b8aa6": {
        "aToken": "0x77e305b4d4d3b9da4e82cefd564f5b948366a44b",
        "vToken": "0x5f62aea5549cdf5dc309255946d69e516a9c2042"
      },
      "0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2": {
        "aToken": "0x5c44c9e5182193ce4e24b8f85c9c914c59d57767",
        "vToken": "0x068b5441787b0b973e25d5dbdacb7a7c2161af51"
      },
      "0x2416092f143378750bb29b79ed961ab195cceea5": {
        "aToken": "0x0684fc172a0b8e6a65cf4684edb2082272fe9050",
        "vToken": "0xcc7b5fd2f290a61587352343b7cf77bb35cb6f00"
      },
      "0x3aab2285ddcddad8edf438c1bab47e1a9d05a9b4": {
        "aToken": "0x8b6e58ea81679eecd63468c6d4eaefa48a45868d",
        "vToken": "0xf61a1d02103958b8603f1780702982e2ec9f9e68"
      },
      "0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5": {
        "aToken": "0x0f87d0618b873be947ff7d3620c51b832b71c4d0",
        "vToken": "0x0889b840f9285d790ccd3d09703af347e0299f42"
      },
      "0x5a7a183b6b44dc4ec2e3d2ef43f98c5152b1d76d": {
        "aToken": "0x4585cbe390df68cbaa36c0d0886e8528c31c7c11",
        "vToken": "0x53a44b6384c28c099dc168fd1d9044105e23c632"
      },
      "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": {
        "aToken": "0x529d26aae1606910ab32e1aeb9dbee8597618f28",
        "vToken": "0xabe144177c341e30a35cde436ee159cd7c1db77a"
      },
      "0x5ffce65a40f6d3de5332766fff6a28bf491c868c": {
        "aToken": "0x8fab2e296934d9e930aa6c3150059b0b4adb06f5",
        "vToken": "0x46519da582e2231e05613f0908ac991374905db6"
      },
      "0x894134a25a5fac1c2c26f1d8fbf05111a3cb9487": {
        "aToken": "0xe7e54ca3d6f8a5561f8cee361260e537bdc5be48",
        "vToken": "0xe6b9b00d42fa5831cce4e44d9d6d8c51ba17cd1e"
      },
      "0x93f4d0ab6a8b4271f4a28db399b5e30612d21116": {
        "aToken": "0xccf76f25d5cc39db7cd644a5a66eff91b2cdcc25",
        "vToken": "0xd039544fca3d8df85a0f4441fdf8b0836db97871"
      },
      "0xa219439258ca9da29e9cc4ce5596924745e12b93": {
        "aToken": "0x508c39cd02736535d5cb85f3925218e5e0e8f07a",
        "vToken": "0x476f206511a18c9956fc79726108a03e647a1817"
      },
      "0xb20116ee399f15647bb1eef9a74f6ef3b58bc951": {
        "aToken": "0x5bb96d49de7f1049dabe055d37f1a32f05639756",
        "vToken": "0x35f01b5200165b5cf67b09917452b0e434a63965"
      },
      "0xb5bedd42000b71fdde22d3ee8a79bd49a568fc8f": {
        "aToken": "0x9eb8879231c71bd739967628ca26b72810beead8",
        "vToken": "0xa26982964e57e8cb5639e3a44c55f085695e0a26"
      },
      "0xd2671165570f41bbb3b0097893300b6eb6101e6c": {
        "aToken": "0x8d8b70a576113feedd7e3810ce61f5e243b01264",
        "vToken": "0x3da71ad7e055ee9716bba4dac53e37cddf60d509"
      },
      "0xe4d584ae9b753e549cae66200a6475d2f00705f7": {
        "aToken": "0x537d6dd4e12c16efa951591c66d0c1a14970a980",
        "vToken": "0x205e01ef33fcd660ff4a7caa6d12413f23d2bace"
      },
      "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f": {
        "aToken": "0xb4ffef15daf4c02787bc5332580b838ce39805f5",
        "vToken": "0xcb2da0f5aece616e2cbf29576cfc795fb15c6133"
      },
      "0xecc68d0451e20292406967fe7c04280e5238ac7d": {
        "aToken": "0x1820335eba09b72ce46c0de4650f71c7505b4824",
        "vToken": "0x06ecdfde2d468aed563d5765356b6def4901b6bc"
      },
      "0xf3b001d64c656e30a62fbaaca003b1336b4ce12a": {
        "aToken": "0x759cb97fbc452bafd49992ba88d3c5da4dd9b0e7",
        "vToken": "0xc1d9ca73f57930d4303d380c5dc668c40b38598b"
      }
    }
  }
} as const