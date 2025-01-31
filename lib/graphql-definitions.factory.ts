import { makeExecutableSchema } from '@graphql-tools/schema';
import { loadPackage } from '@nestjs/common/utils/load-package.util';
import { isEmpty } from '@nestjs/common/utils/shared.utils';
import { gql } from 'apollo-server-core';
import * as chokidar from 'chokidar';
import { printSchema } from 'graphql';
import {
  DefinitionsGeneratorOptions,
  GraphQLAstExplorer,
} from './graphql-ast.explorer';
import { GraphQLTypesLoader } from './graphql-types.loader';
import { extend, removeTempField } from './utils';

export class GraphQLDefinitionsFactory {
  private readonly gqlAstExplorer = new GraphQLAstExplorer();
  private readonly gqlTypesLoader = new GraphQLTypesLoader();

  async generate(
    options: {
      typePaths: string[];
      path: string;
      outputAs?: 'class' | 'interface';
      watch?: boolean;
      debug?: boolean;
      federation?: boolean;
      typeDefs?: string | string[];
    } & DefinitionsGeneratorOptions,
  ) {
    const isDebugEnabled = !(options && options.debug === false);
    const typePathsExists = options.typePaths && !isEmpty(options.typePaths);
    if (!typePathsExists) {
      throw new Error(`"typePaths" property cannot be empty.`);
    }

    const isFederation = options && options.federation;
    const definitionsGeneratorOptions: DefinitionsGeneratorOptions = {
      emitTypenameField: options.emitTypenameField,
      skipResolverArgs: options.skipResolverArgs,
      defaultScalarType: options.defaultScalarType,
      customScalarTypeMapping: options.customScalarTypeMapping,
      additionalHeader: options.additionalHeader,
      defaultTypeMapping: options.defaultTypeMapping,
      enumsAsTypes: options.enumsAsTypes,
    };

    if (options.watch) {
      this.printMessage(
        'GraphQL factory is watching your files...',
        isDebugEnabled,
      );
      const watcher = chokidar.watch(options.typePaths);
      watcher.on('change', async (file) => {
        this.printMessage(
          `[${new Date().toLocaleTimeString()}] "${file}" has been changed.`,
          isDebugEnabled,
        );
        await this.exploreAndEmit(
          options.typePaths,
          options.path,
          options.outputAs,
          isFederation,
          isDebugEnabled,
          definitionsGeneratorOptions,
          options.typeDefs
        );
      });
    }
    await this.exploreAndEmit(
      options.typePaths,
      options.path,
      options.outputAs,
      isFederation,
      isDebugEnabled,
      definitionsGeneratorOptions,
      options.typeDefs
    );
  }

  private async exploreAndEmit(
    typePaths: string[],
    path: string,
    outputAs: 'class' | 'interface',
    isFederation: boolean,
    isDebugEnabled: boolean,
    definitionsGeneratorOptions: DefinitionsGeneratorOptions = {},
    typeDefs?: string | string[]
  ) {
    if (isFederation) {
      return this.exploreAndEmitFederation(
        typePaths,
        path,
        outputAs,
        isDebugEnabled,
        definitionsGeneratorOptions,
        typeDefs
      );
    }
    return this.exploreAndEmitRegular(
      typePaths,
      path,
      outputAs,
      isDebugEnabled,
      definitionsGeneratorOptions,
      typeDefs
    );
  }

  private async exploreAndEmitFederation(
    typePaths: string[],
    path: string,
    outputAs: 'class' | 'interface',
    isDebugEnabled: boolean,
    definitionsGeneratorOptions: DefinitionsGeneratorOptions,
    typeDefs?: string | string[]
  ) {
    const typePathDefs = await this.gqlTypesLoader.mergeTypesByPaths(typePaths);
    const mergedTypeDefs = extend(typePathDefs, typeDefs);

    const { buildFederatedSchema } = loadPackage(
      '@apollo/federation',
      'ApolloFederation',
      () => require('@apollo/federation'),
    );

    const { printSubgraphSchema } = loadPackage(
      '@apollo/subgraph',
      'ApolloFederation',
      () => require('@apollo/subgraph'),
    );

    const schema = buildFederatedSchema([
      {
        typeDefs: gql`
          ${mergedTypeDefs}
        `,
        resolvers: {},
      },
    ]);
    const tsFile = await this.gqlAstExplorer.explore(
      gql`
        ${printSubgraphSchema(schema)}
      `,
      path,
      outputAs,
      definitionsGeneratorOptions,
    );
    await tsFile.save();
    this.printMessage(
      `[${new Date().toLocaleTimeString()}] The definitions have been updated.`,
      isDebugEnabled,
    );
  }

  private async exploreAndEmitRegular(
    typePaths: string[],
    path: string,
    outputAs: 'class' | 'interface',
    isDebugEnabled: boolean,
    definitionsGeneratorOptions: DefinitionsGeneratorOptions,
    typeDefs?: string | string[]
  ) {
    const typePathDefs = await this.gqlTypesLoader.mergeTypesByPaths(typePaths  || []);
    const mergedTypeDefs = extend(typePathDefs, typeDefs);
    if (!mergedTypeDefs) {
      throw new Error(`"typeDefs" property cannot be null.`);
    }
    let schema = makeExecutableSchema({
      typeDefs: mergedTypeDefs,
      resolverValidationOptions: { requireResolversToMatchSchema: 'ignore' },
    });
    schema = removeTempField(schema);
    const tsFile = await this.gqlAstExplorer.explore(
      gql`
        ${printSchema(schema)}
      `,
      path,
      outputAs,
      definitionsGeneratorOptions,
    );
    await tsFile.save();
    this.printMessage(
      `[${new Date().toLocaleTimeString()}] The definitions have been updated.`,
      isDebugEnabled,
    );
  }

  private printMessage(text: string, isEnabled: boolean) {
    isEnabled && console.log(text);
  }
}
