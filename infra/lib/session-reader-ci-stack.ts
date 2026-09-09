import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

const GH = 'token.actions.githubusercontent.com';
const GITHUB_REPO = 'johncarmack1984@20649979/session-reader@1362932861';
const CDK_QUALIFIER = 'hnb659fds';
const OIDC_PROVIDER_ARN = `arn:aws:iam::735853783919:oidc-provider/${GH}`;

export class SessionReaderCiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const provider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidc',
      OIDC_PROVIDER_ARN,
    );

    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'session-reader-github-deploy',
      description: 'GitHub Actions OIDC deploy role for session-reader.',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.OpenIdConnectPrincipal(provider, {
        StringEquals: {
          [`${GH}:aud`]: 'sts.amazonaws.com',
          [`${GH}:sub`]: `repo:${GITHUB_REPO}:ref:refs/heads/main`,
        },
      }),
    });

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-${CDK_QUALIFIER}-*`],
      }),
    );

    new cdk.CfnOutput(this, 'CiDeployRoleArn', {
      description: 'Set this as the repo variable AWS_DEPLOY_ROLE_ARN',
      value: role.roleArn,
    });
  }
}
