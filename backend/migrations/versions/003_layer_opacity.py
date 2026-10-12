"""add layer opacity

Revision ID: 003
Revises: 002
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('layers', sa.Column('opacity', sa.Float(), nullable=False, server_default='1'))


def downgrade():
    op.drop_column('layers', 'opacity')
