#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SessionReaderStack } from '../lib/session-reader-stack';
import { SessionReaderCiStack } from '../lib/session-reader-ci-stack';

const app = new cdk.App();
new SessionReaderStack(app, 'SessionReaderStack', {
  env: { account: '735853783919', region: 'us-east-1' },
});

new SessionReaderCiStack(app, 'SessionReaderCiStack', {
  env: { account: '735853783919', region: 'us-east-1' },
});
