"""Persist user categories, including empty categories."""
from alembic import op
import sqlalchemy as sa
revision='010'
down_revision='009'
branch_labels=None
depends_on=None

def upgrade():
    op.create_table('catalog_categories',sa.Column('id',sa.Integer(),primary_key=True),
        sa.Column('name',sa.String(200),nullable=False,unique=True),
        sa.Column('description',sa.String(1000),nullable=False))

def downgrade():
    op.drop_table('catalog_categories')
