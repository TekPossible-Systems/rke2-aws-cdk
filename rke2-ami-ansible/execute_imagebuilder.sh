#!/bin/bash
# "AVAILABLE" is desired end state for the image builder pipeline
yum install -y git python3-pip
pip3 install git-remote-codecommit
git config --global credential.helper '!aws codecommit credential-helper $@'
git config --global credential.UseHttpPath true
export CURRENT_BRANCH="main"
export CI_CD_USERNAME="CI/CD PILLOWNET"
export CI_CD_EMAIL="ci-cd@tekpossible.com"
export CDK_STACK_BASE_NAME_LOWER="pillow-rke2-ami-ec2ib"
export SSM_PARAMETER_NAME="$CDK_STACK_BASE_NAME_LOWER-$CURRENT_BRANCH-ami"
export IMAGE_PIPELINE_ARN=$(aws ssm get-parameter --name $CDK_STACK_BASE_NAME_LOWER-imagebuilder-arn-$CURRENT_BRANCH --query 'Parameter.Value' | sed 's/"//g')
export IMAGE_VERSION_ARN=$(aws imagebuilder start-image-pipeline-execution --image-pipeline-arn $IMAGE_PIPELINE_ARN --query 'imageBuildVersionArn' | sed 's/"//g')
export IMAGE_STATE=$(aws imagebuilder get-image --image-build-version-arn $IMAGE_VERSION_ARN --query 'image.state.status'  | sed 's/"//g')
export REGION=$(aws ssm get-parameter --name $CDK_STACK_BASE_NAME_LOWER-region --query 'Parameter.Value' | sed 's/"//g')
export BUCKET_NAME="pillow-rke2-ami-ec2ib-pipeline-storage-$CURRENT_BRANCH"
echo "The Image Builder Pipeline started. Please go to the imagebuilder pipeline console if you wish to see more about this build"
echo "The image version ARN is $IMAGE_VERSION_ARN"

while [ "$IMAGE_STATE" != "AVAILABLE" ]
do 
	if [ "$IMAGE_STATE" = 'FAILED' ]; then 
		echo "Failure in image builder pipeline. Please look at the image builder logs"  
		exit 1 
	fi
	export IMAGE_STATE=$(aws imagebuilder get-image --image-build-version-arn $IMAGE_VERSION_ARN --query 'image.state.status'  | sed 's/"//g')
done

echo "Image builder succeeded. Working on commiting the AMI ID to the infrastructure repo..."
export AMI_IMAGE_ID=$(aws ec2 describe-images --filters "Name=tag:Ec2ImageBuilderArn,Values=$IMAGE_VERSION_ARN" --query 'Images[0].ImageId' | sed 's/"//g')
echo "The following AMI ID will be used: $AMI_IMAGE_ID"

# GRAB the Generated Artifacts and Stage them in our current directory
aws s3 cp s3://$BUCKET_NAME/artifact-os-security.zip ./artifact-os-security.zip

# Push the AMI ID to the SSM Parameter store
aws ssm put-parameter --name $SSM_PARAMETER_NAME --overwrite --type String --value $AMI_IMAGE_ID